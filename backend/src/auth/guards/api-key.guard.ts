import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const API_KEY_SCOPES_KEY = 'api_key_scopes';
export const RequireApiKeyScopes = (...scopes: string[]) =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);

export interface ApiKeyPartner {
  id: string;
  partnerName: string;
  scopes: string[];
  ipWhitelist: string[];
  expiresAt: Date;
  status: 'active' | 'revoked' | 'expired';
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKeyHeader = request.headers['x-api-key'] || request.headers['authorization'];

    if (!apiKeyHeader) {
      throw new UnauthorizedException('API key is required');
    }

    const rawKey = typeof apiKeyHeader === 'string' && apiKeyHeader.startsWith('Bearer ')
      ? apiKeyHeader.slice(7)
      : apiKeyHeader;

    // Validate key prefix (e.g., agfi_live_* or agfi_test_*)
    if (!rawKey.startsWith('agfi_live_') && !rawKey.startsWith('agfi_test_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    // Mock partner record retrieved from database by key hash
    const partner: ApiKeyPartner = {
      id: 'partner-uuid-001',
      partnerName: 'Integration Partner Bank',
      scopes: ['deals:read', 'deals:write', 'investments:read', 'milestones:write', 'webhooks:manage'],
      ipWhitelist: ['127.0.0.1', '::1'],
      expiresAt: new Date(Date.now() + 86400000 * 365),
      status: 'active',
    };

    if (partner.status !== 'active') {
      throw new UnauthorizedException(`API key is ${partner.status}`);
    }

    if (new Date() > partner.expiresAt) {
      throw new UnauthorizedException('API key has expired');
    }

    // IP Whitelisting check
    const clientIp = request.ip || request.connection?.remoteAddress;
    if (partner.ipWhitelist.length > 0 && clientIp) {
      const isAllowed = partner.ipWhitelist.includes(clientIp) || clientIp.includes('127.0.0.1');
      if (!isAllowed) {
        throw new ForbiddenException(`IP address ${clientIp} not in whitelist`);
      }
    }

    // Scope-based permission enforcement
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(API_KEY_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) => partner.scopes.includes(scope));
      if (!hasAllScopes) {
        throw new ForbiddenException('Insufficient API key permissions');
      }
    }

    request.partner = partner;
    return true;
  }
}
