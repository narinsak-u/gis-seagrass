import type { ActorRole, AuthenticatedActor } from '../../domain/actor';

export interface AuthUserRecord {
  id: string;
  password_hash: string;
  is_active: boolean;
}

export interface AuthRepository {
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  findActiveActorById(id: string): Promise<AuthenticatedActor | null>;
  hasEmail(email: string): Promise<boolean>;
  insertIfAbsent(user: { id: string; email: string; passwordHash: string; role: ActorRole }): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
