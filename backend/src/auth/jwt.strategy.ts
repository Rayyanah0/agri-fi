import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { User } from './entities/user.entity';
import { TokenBlocklistService } from './token-blocklist.service';
import { BehavioralRiskService } from './behavioral-risk.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tokenVersion?: number;
  typ?: 'access' | 'refresh';
  /** Unique id for this refresh token — used to detect rotation replay. */
  jti?: string;
  /** Id shared by every refresh token in a rotation chain. */
  familyId?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly tokenBlocklistService: TokenBlocklistService,
    private readonly behavioralRiskService: BehavioralRiskService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<User> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (
      rawToken &&
      (await this.tokenBlocklistService.isBlocklisted(rawToken))
    ) {
      throw new UnauthorizedException('Token has been revoked.');
    }

    if (payload.typ === 'refresh') {
      throw new UnauthorizedException(
        'Refresh tokens cannot be used as access tokens.',
      );
    }
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException('Token no longer valid.');
    }

    // Adaptive authentication: consult the behavioral risk decision. A
    // high-risk signal (or an explicit re-authentication flag attached to the
    // request by upstream behavioral middleware) forces re-authentication.
    const requiresReauth =
      (req as Request & { behavioralReauthRequired?: boolean })
        .behavioralReauthRequired === true ||
      this.behavioralRiskService.requiresReauthentication(user.id);
    if (requiresReauth) {
      throw new UnauthorizedException(
        'Re-authentication required due to elevated behavioral risk.',
      );
    }

    return user;
  }
}
