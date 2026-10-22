import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Span, SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import { TracingService } from './tracing.service';

export interface TracedRequest extends Request {
  traceId?: string;
  __otelSpan?: Span;
}

/**
 * Instruments inbound HTTP requests (#1233): extracts the upstream W3C
 * `traceparent`, starts a SERVER span, records the response status, ends the
 * span, and exposes the trace id on `req.traceId` so the pino logger can attach
 * it to every log line.
 */
@Injectable()
export class TracingMiddleware implements NestMiddleware {
  constructor(private readonly tracing: TracingService) {}

  use(req: TracedRequest, res: Response, next: NextFunction): void {
    const parentContext = this.tracing.extractContext(
      req.headers as Record<string, unknown>,
    );

    const span = this.tracing.startServerSpan(
      `${req.method} ${req.baseUrl || req.path}`,
      parentContext,
      {
        'http.request.method': req.method,
        'url.path': req.originalUrl,
        'url.scheme': req.protocol,
        'user_agent.original': req.headers['user-agent'] ?? '',
        'client.address': req.ip,
      },
    );

    req.__otelSpan = span;
    req.traceId = span.spanContext().traceId;

    const endSpan = () => {
      span.setAttribute('http.response.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    };
    let ended = false;
    const endOnce = () => {
      if (ended) return;
      ended = true;
      endSpan();
    };
    res.on('finish', endOnce);
    res.on('close', endOnce);

    // Run the downstream handlers inside the span's context so any child spans
    // and the active-span helpers resolve correctly.
    otelContext.with(
      trace.setSpan(parentContext, span),
      () => next(),
    );
  }
}
