import { Injectable } from '@nestjs/common';
import {
  Attributes,
  Context,
  Span,
  SpanKind,
  SpanOptions,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';

const TRACER_NAME = 'agri-fi-backend';

/**
 * Thin, injectable wrapper around the OpenTelemetry API (#1233). Keeps the rest
 * of the codebase free of direct OTel imports and makes spans trivial to create
 * and to test.
 */
@Injectable()
export class TracingService {
  tracer() {
    return trace.getTracer(TRACER_NAME, process.env.npm_package_version || '0.1.0');
  }

  /** The trace id of the currently active span, if any. */
  getActiveTraceId(): string | undefined {
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    return spanContext?.traceId;
  }

  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /** Runs `fn` inside a new span, recording errors and ending the span. */
  async withSpan<T>(
    name: string,
    options: SpanOptions,
    fn: (span: Span) => Promise<T> | T,
  ): Promise<T> {
    const span = this.tracer().startSpan(name, options);
    try {
      return await context.with(
        trace.setSpan(context.active(), span),
        fn,
        undefined,
        span,
      ) as T;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error)?.message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /** Starts a span and returns it; the caller is responsible for ending it. */
  startSpan(name: string, options: SpanOptions = {}): Span {
    return this.tracer().startSpan(name, options);
  }

  startServerSpan(
    name: string,
    parentContext: Context,
    attributes: Attributes = {},
  ): Span {
    return this.tracer().startSpan(
      name,
      { kind: SpanKind.SERVER, attributes },
      parentContext,
    );
  }

  /** Extracts a W3C trace context from inbound carriers (e.g. HTTP headers). */
  extractContext(carrier: Record<string, unknown>): Context {
    return propagation.extract(context.active(), carrier as never);
  }

  /** Injects the active context into an outbound carrier (e.g. HTTP headers). */
  injectContext(carrier: Record<string, unknown>): void {
    propagation.inject(context.active(), carrier as never);
  }

  markError(span: Span, error: unknown): void {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (error as Error)?.message,
    });
  }
}
