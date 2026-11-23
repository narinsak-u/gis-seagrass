import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../database/provider';
import { users } from '../../database/schema';
import type { AuthStorePort, AuthUserRecord } from '../auth-store.port';

@Injectable()
export class DrizzleAuthStore implements AuthStorePort {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const [user] = await this.db.select({ id: users.id, password_hash: users.passwordHash, is_active: users.isActive })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user ?? null;
  }

  async hasEmail(email: string): Promise<boolean> {
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return user !== undefined;
  }

  async insertIfAbsent(user: { id: string; email: string; passwordHash: string; role: 'viewer' | 'editor' | 'admin' }): Promise<void> {
    await this.db.insert(users).values({
      id: user.id, email: user.email, passwordHash: user.passwordHash, role: user.role,
    }).onConflictDoNothing({ target: users.email });
  }
}
