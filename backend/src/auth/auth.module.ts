import { ThrottlerModule } from '@nestjs/throttler';
import { type DynamicModule, Module } from '@nestjs/common';
import type { DatabaseProvider } from '../platform/database';
import { AuthService } from './application/auth.service';
import { requireJwtSecret } from './application/auth-token';
import { AUTH_REPOSITORY, type AuthRepository } from './application/auth.repository';
import { AuthGuard } from './presentation/auth.guard';
import { AuthController } from './presentation/auth.controller';
import { DrizzleAuthRepository } from './infrastructure/drizzle-auth.repository';

@Module({})
export class AuthModule {
  static register(databaseModule: DynamicModule): DynamicModule {
    return {
      module: AuthModule,
      imports: [databaseModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
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
    };
  }
}

export { AuthGuard, Roles } from './presentation/auth.guard';
export type { AuthenticatedRequest } from './presentation/auth.guard';
export type { ActorRole, AuthenticatedActor } from './domain/actor';
export { requireJwtSecret };
export { configureLoginBodyParsing } from './presentation/malformed-login-json.middleware';

export async function seedDevelopmentAccounts(database: DatabaseProvider, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const users = new DrizzleAuthRepository(database.db);
  await new AuthService(users).seedDevelopmentAccounts(true);
}
