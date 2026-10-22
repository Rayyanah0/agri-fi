import { EventEmitter } from 'events';
import {
  trace,
  propagation,
  context,
  SpanKind,
  SpanStatusCode,
  context as otelContext,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { TracingService } from './tracing.service';
import { TracingMiddleware, TracedRequest } from './tracing.middleware';

// The OpenTelemetry provider / propagator are process-wide singletons, so they
// are registered exactly once for the whole suite and the exporter is cleared
// between tests instead of re-registering a new provider.
let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
let service: TracingService;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'test' }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  service = new TracingService();
});

afterEach(() => {
  exporter.reset();
});

afterAll(async () => {
  await provider.shutdown();
});

describe('TracingService (#1233)', () => {
  it('creates a span and exposes the active trace id', async () => {
    const traceId = await service.withSpan(
      'unit-of-work',
      { attributes: { 'app.key': 'value' } },
      (span) => {
        span.setAttribute('done', true);
        return service.getActiveTraceId();
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('unit-of-work');
    expect(spans[0].attributes['app.key']).toBe('value');
    expect(spans[0].attributes['done']).toBe(true);
    expect(traceId).toBe(spans[0].spanContext().traceId);
  });

  it('records errors and rethrows', async () => {
    await expect(
      service.withSpan('boom', {}, () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');

    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('round-trips the trace context through a carrier', async () => {
    await service.withSpan('producer', {}, () => {
      const carrier: Record<string, unknown> = {};
      service.injectContext(carrier);
      expect(String(carrier.traceparent)).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-/,
      );

      const extracted = service.extractContext(carrier);
      const span = trace.getSpan(extracted);
      expect(span?.spanContext().traceId).toBe(service.getActiveTraceId());
    });
  });

  it('continues an upstream trace for server spans', () => {
    const upstream = provider.getTracer('upstream').startSpan('incoming');
    const parentContext = trace.setSpan(otelContext.active(), upstream);
    const upstreamTraceId = upstream.spanContext().traceId;

    const server = service.startServerSpan('GET /x', parentContext);
    expect(server.kind).toBe(SpanKind.SERVER);
    expect(server.spanContext().traceId).toBe(upstreamTraceId);
    server.end();
    upstream.end();
  });
});

describe('TracingMiddleware (#1233)', () => {
  it('adopts an upstream traceparent and enriches the request', (done) => {
    const upstreamTraceId = 'a'.repeat(32);
    const req = {
      method: 'GET',
      path: '/v1/oracles/feeds',
      baseUrl: '',
      originalUrl: '/v1/oracles/feeds',
      protocol: 'http',
      ip: '127.0.0.1',
      headers: {
        traceparent: `00-${upstreamTraceId}-${'b'.repeat(16)}-01`,
        'user-agent': 'jest',
      },
    } as unknown as TracedRequest;

    const res = new EventEmitter() as unknown as {
      statusCode: number;
    } & EventEmitter;
    res.statusCode = 200;

    new TracingMiddleware(service).use(req, res, () => {
      expect(req.traceId).toBe(upstreamTraceId);
      (res as EventEmitter).emit('finish');
      const [span] = exporter.getFinishedSpans();
      expect(span.spanContext().traceId).toBe(upstreamTraceId);
      expect(span.attributes['http.request.method']).toBe('GET');
      expect(span.attributes['http.response.status_code']).toBe(200);
      done();
    });
  });

  it('starts a new trace when no traceparent is present', (done) => {
    const req = {
      method: 'POST',
      path: '/v1/oracles/feeds',
      baseUrl: '',
      originalUrl: '/v1/oracles/feeds',
      protocol: 'http',
      ip: '127.0.0.1',
      headers: {},
    } as unknown as TracedRequest;
    const res = new EventEmitter() as unknown as {
      statusCode: number;
    } & EventEmitter;
    res.statusCode = 201;

    new TracingMiddleware(service).use(req, res, () => {
      expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
      (res as EventEmitter).emit('finish');
      expect(exporter.getFinishedSpans()).toHaveLength(1);
      done();
    });
  });
});
