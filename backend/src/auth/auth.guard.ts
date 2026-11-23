import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { verifyAccessToken, type AccessTokenClaims } from './auth.controller';

export type ActorRole = 'viewer' | 'editor' | 'admin';
export interface AuthenticatedActor { id: string; role: ActorRole }
export interface AuthenticatedRequest { user: AuthenticatedActor; headers: { authorization?: string } }

const REQUIRED_ROLES = 'required-roles';

export const Roles = (...roles: ActorRole[]) => SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly pool: Pool, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' && /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) throw this.unauthorized();

    let claims: AccessTokenClaims;
    try {
      claims = verifyAccessToken(match[1]);
    } catch {
      throw this.unauthorized();
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) throw this.unauthorized();
    const result = await this.pool.query<{ id: string; role: ActorRole }>(
      'SELECT id, role FROM users WHERE id = $1 AND is_active = true', [claims.sub],
    );
    const user = result.rows[0];
    if (!user) throw this.unauthorized();
    request.user = { id: user.id, role: user.role };

    const roles = this.reflector.getAllAndOverride<ActorRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient permissions', details: {} });
    }
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required', details: {} });
  }
}
