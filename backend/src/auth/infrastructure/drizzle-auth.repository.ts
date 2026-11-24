import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../platform/database';
import { users } from '../../platform/database';
import type { AuthRepository, AuthUserRecord } from '../application/auth.repository';
import type { ActorRole, AuthenticatedActor } from '../domain/actor';

@Injectable()
export class DrizzleAuthRepository implements AuthRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const [user] = await this.db.select({ id: users.id, password_hash: users.passwordHash, is_active: users.isActive })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user ?? null;
  }
  async findActiveActorById(id: string): Promise<AuthenticatedActor | null> {
    const [user] = await this.db.select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, id), eq(users.isActive, true)))
      .limit(1);
    return user ? { id: user.id, role: user.role as ActorRole } : null;
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
