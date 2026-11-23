import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../shared';
import type { AuthenticatedActor } from '../../domain/actor';
import type { AuthRepository } from '../contracts/auth-repository';
import { hashPassword, signAccessToken, TOKEN_LIFETIME_SECONDS, verifyAccessToken, verifyPassword } from '../security/auth-token';
const DEVELOPMENT_ACCOUNTS = [
  { role: 'viewer', password: 'dev-viewer-password' },
  { role: 'editor', password: 'dev-editor-password' },
  { role: 'admin', password: 'dev-admin-password' },
] as const;
const dummyPasswordHash = hashPassword('nonexistent-account-password');

export class AuthService {
  constructor(private readonly users: AuthRepository) {}

  async login(email: string, password: string): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    const user = await this.users.findByEmail(email);
    const passwordMatches = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash);
    if (!user || !user.is_active || !passwordMatches) {
      throw new ApplicationError('UNAUTHORIZED', 'Invalid email or password');
    }
    return { access_token: signAccessToken(user.id), token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS };
  }
  async resolveAccessToken(token: string): Promise<AuthenticatedActor | null> {
    let subject: string;
    try {
      subject = verifyAccessToken(token).sub;
    } catch {
      return null;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject)) return null;
    return this.users.findActiveActorById(subject);
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
