import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SpanStatusCode } from '@opentelemetry/api';
import { TracedRequest } from './tracing.middleware';

/**
 * Enriches the active request span (#1233) with routing and end-user context
 * once Nest has resolved the controller/handler — information that is not yet
 * available in the HTTP middleware.
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<TracedRequest>();
    const span = request.__otelSpan;
    const controller = context.getClass()?.name;
    const handler = context.getHandler()?.name;
    const route = [controller, handler].filter(Boolean).join('.');

    if (span) {
      if (route) {
        span.updateName(`${request.method} ${route}`);
        span.setAttribute('http.route', route);
      }
      const user = (request as TracedRequest & { user?: { id?: string; role?: string } }).user;
      if (user?.id) {
        span.setAttribute('user.id', user.id);
        span.setAttribute('enduser.id', user.id);
      }
      if (user?.role) {
        span.setAttribute('user.role', user.role);
      }
      if (request.traceId) {
        span.setAttribute('app.trace_id', request.traceId);
      }
    }

    return new Observable((subscriber) => {
      next.handle().subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => {
          if (span) {
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error)?.message,
            });
          }
          subscriber.error(error);
        },
        complete: () => subscriber.complete(),
      });
    });
  }
}
