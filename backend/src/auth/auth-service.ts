import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../domain/application-error';
import { AUTH_STORE_PORT, type AuthStorePort } from './auth-store.port';
import { hashPassword, signAccessToken, verifyPassword } from './auth-token';

const TOKEN_LIFETIME_SECONDS = 900;
const DEVELOPMENT_ACCOUNTS = [
  { role: 'viewer', password: 'dev-viewer-password' },
  { role: 'editor', password: 'dev-editor-password' },
  { role: 'admin', password: 'dev-admin-password' },
] as const;
const dummyPasswordHash = hashPassword('nonexistent-account-password');

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_STORE_PORT) private readonly users: AuthStorePort) {}

  async login(email: string, password: string): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    const user = await this.users.findByEmail(email);
    const passwordMatches = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash);
    if (!user || !user.is_active || !passwordMatches) {
      throw new ApplicationError('UNAUTHORIZED', 'Invalid email or password');
    }
    return { access_token: signAccessToken(user.id), token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS };
  }

  async seedDevelopmentAccounts(enabled: boolean): Promise<void> {
    if (!enabled) return;
    const prefix = process.env.DEV_ACCOUNT_EMAIL_PREFIX ?? 'dev';
    for (const account of DEVELOPMENT_ACCOUNTS) {
      const email = `${prefix}-${account.role}@example.test`;
      if (await this.users.hasEmail(email)) continue;
      await this.users.insertIfAbsent({
        id: randomUUID(), email, passwordHash: await hashPassword(account.password), role: account.role,
      });
    }
  }
}
