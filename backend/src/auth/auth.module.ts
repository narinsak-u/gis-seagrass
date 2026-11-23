import { Module } from '@nestjs/common';
import type { DatabaseProvider } from '../platform/database';
import { AuthService } from './application/use-cases/auth-service';
import { requireJwtSecret } from './application/security/auth-token';
import { AUTH_REPOSITORY, type AuthRepository } from './application/contracts/auth-repository';
import { AuthGuard } from './http/auth.guard';
import { AuthController } from './http/auth.controller';
import { DrizzleAuthRepository } from './infrastructure/repositories/drizzle-auth-repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthGuard,
    DrizzleAuthRepository,
    { provide: AUTH_REPOSITORY, useExisting: DrizzleAuthRepository },
    {
      provide: AuthService,
      useFactory: (users: AuthRepository) => new AuthService(users),
      inject: [AUTH_REPOSITORY],
    },
  ],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}

export { AuthGuard, Roles } from './http/auth.guard';
export type { AuthenticatedRequest } from './http/auth.guard';
export type { ActorRole, AuthenticatedActor } from './domain/actor';
export { requireJwtSecret };

export async function seedDevelopmentAccounts(database: DatabaseProvider, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const users = new DrizzleAuthRepository(database.db);
  await new AuthService(users).seedDevelopmentAccounts(true);
}
