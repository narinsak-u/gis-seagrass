import { type AccessTokenClaims, verifyAccessToken } from './auth-token';
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../database/provider';
import { users } from '../database/schema';

export type ActorRole = 'viewer' | 'editor' | 'admin';
export interface AuthenticatedActor { id: string; role: ActorRole }
export interface AuthenticatedRequest { user: AuthenticatedActor; headers: { authorization?: string } }

const REQUIRED_ROLES = 'required-roles';

export const Roles = (...roles: ActorRole[]) => SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db'],
    private readonly reflector: Reflector,
  ) {}

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
    const [user] = await this.db.select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, claims.sub), eq(users.isActive, true)))
      .limit(1);
    if (!user) throw this.unauthorized();
    request.user = { id: user.id, role: user.role as ActorRole };

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
