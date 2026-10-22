import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiUsageService } from './api-usage.service';

@Injectable()
export class ApiUsageInterceptor implements NestInterceptor {
  constructor(private readonly usageService: ApiUsageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const key = request.apiKey;
    if (!key?.id || !key?.ownerId) return next.handle();

    const startedAt = Date.now();
    const endpoint = request.route?.path
      ? `/v1/public${request.route.path}`
      : String(request.path ?? '/v1/public');
    const record = (statusCode: number, body: unknown) => {
      const bodyBytes = Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? ''));
      const headerBytes = Number(response.getHeader?.('content-length')) || 0;
      this.usageService.record({
        ownerId: key.ownerId,
        apiKeyId: key.id,
        method: String(request.method ?? 'GET').slice(0, 10),
        endpoint: endpoint.slice(0, 160),
        statusCode,
        dataTransferBytes: Math.max(bodyBytes, headerBytes),
        computeTimeMs: Math.max(0, Date.now() - startedAt),
        anomalous: bodyBytes > 10 * 1024 * 1024 || Date.now() - startedAt > 30_000,
      }).catch(() => undefined);
    };

    return next.handle().pipe(
      tap({
        next: (body) => record(response.statusCode || 200, body),
        error: (error) => record(error?.status || error?.statusCode || 500, error?.response),
      }),
    );
  }
}