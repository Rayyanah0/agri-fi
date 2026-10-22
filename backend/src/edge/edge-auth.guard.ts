import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class EdgeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const nodeId = request.header('x-edge-node');
    const timestamp = request.header('x-edge-timestamp');
    const supplied = request.header('x-edge-signature');
    if (typeof nodeId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(nodeId) || typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp) || typeof supplied !== 'string') {
      throw new UnauthorizedException('Missing or invalid edge authentication headers');
    }

    const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      throw new UnauthorizedException('Edge request timestamp is outside the allowed window');
    }
    const secret = process.env[`EDGE_NODE_SECRET_${nodeId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`];
    if (!secret || secret.length < 32) throw new UnauthorizedException('Edge node is not provisioned');

    const body = request.body ?? {};
    const canonical = `${timestamp}\n${request.method}\n${request.originalUrl}\n${JSON.stringify(body)}`;
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(supplied, 'hex');
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new UnauthorizedException('Invalid edge request signature');
    }
    request.edgeNodeId = nodeId;
    return true;
  }
}