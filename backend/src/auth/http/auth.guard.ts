import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../application/auth-service';
import type { ActorRole, AuthenticatedActor } from '../domain/actor';

export interface AuthenticatedRequest { user: AuthenticatedActor; headers: { authorization?: string } }

const REQUIRED_ROLES = 'required-roles';

export const Roles = (...roles: ActorRole[]) => SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' && /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) throw this.unauthorized();

    const actor = await this.auth.resolveAccessToken(match[1]);
    if (!actor) throw this.unauthorized();
    request.user = actor;

    const roles = this.reflector.getAllAndOverride<ActorRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(actor.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient permissions', details: {} });
    }
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required', details: {} });
  }
}
