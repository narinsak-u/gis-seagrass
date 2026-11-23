import { Module } from '@nestjs/common';
import type { DatabaseProvider } from '../database/provider';
import { AuthController } from './auth.controller';
import { AuthService } from './auth-service';
import { DrizzleAuthStore } from './infrastructure/drizzle-auth-store';
import { AuthGuard } from './auth.guard';
import { AUTH_STORE_PORT } from './auth-store.port';

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, AuthService, DrizzleAuthStore, { provide: AUTH_STORE_PORT, useExisting: DrizzleAuthStore }],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}

export { requireJwtSecret } from './auth-token';

export async function seedDevelopmentAccounts(database: DatabaseProvider, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const users = new DrizzleAuthStore(database.db);
  await new AuthService(users).seedDevelopmentAccounts(true);
}
