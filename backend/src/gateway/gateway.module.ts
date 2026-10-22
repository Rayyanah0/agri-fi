import { Controller, Delete, Get, Module, Query, UseGuards } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { GatewayService } from './gateway.service';
import { GatewayMiddleware } from './gateway.middleware';
import { gatewayConfig } from './gateway.config';

@Controller({ path: 'admin/gateway', version: '1' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class GatewayController {
  constructor(private readonly gw: GatewayService) {}

  @Get('analytics')
  analytics() {
    return this.gw.analytics();
  }

  @Get('config')
  config() {
    return gatewayConfig;
  }

  @Delete('cache')
  purge(@Query('prefix') prefix?: string) {
    return { purged: this.gw.purgeCache(prefix) };
  }
}

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({ secret: c.get<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [GatewayController],
  providers: [GatewayService, GatewayMiddleware],
  exports: [GatewayService, GatewayMiddleware, JwtModule],
})
export class GatewayModule {}
