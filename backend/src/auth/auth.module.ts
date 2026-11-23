import { Module } from '@nestjs/common';
import type { DatabaseProvider } from '../platform/database';
import { AuthService } from './application/auth-service';
import { requireJwtSecret } from './application/auth-token';
import { AUTH_STORE_PORT, type AuthStorePort } from './application/auth-store.port';
import { AuthGuard } from './http/auth.guard';
import { AuthController } from './http/auth.controller';
import { DrizzleAuthStore } from './infrastructure/drizzle-auth-store';

@Module({
  controllers: [AuthController],
  providers: [
    AuthGuard,
    DrizzleAuthStore,
    { provide: AUTH_STORE_PORT, useExisting: DrizzleAuthStore },
    {
      provide: AuthService,
      useFactory: (users: AuthStorePort) => new AuthService(users),
      inject: [AUTH_STORE_PORT],
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
  const users = new DrizzleAuthStore(database.db);
  await new AuthService(users).seedDevelopmentAccounts(true);
}
