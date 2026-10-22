import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TracingService } from './tracing.service';
import { TracingMiddleware } from './tracing.middleware';
import { TracingInterceptor } from './tracing.interceptor';

/**
 * Distributed-tracing module (#1233). Global so any feature module can inject
 * `TracingService` to create child spans without importing this module.
 *
 * The middleware is applied from `AppModule.configure()` to guarantee it runs
 * after the CLS middleware and before the correlation-id middleware.
 */
@Global()
@Module({
  providers: [
    TracingService,
    TracingMiddleware,
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [TracingService, TracingMiddleware],
})
export class TracingModule {}
