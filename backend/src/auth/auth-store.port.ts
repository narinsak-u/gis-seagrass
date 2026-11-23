export interface AuthUserRecord {
  id: string;
  password_hash: string;
  is_active: boolean;
}

export interface AuthStorePort {
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  hasEmail(email: string): Promise<boolean>;
  insertIfAbsent(user: { id: string; email: string; passwordHash: string; role: 'viewer' | 'editor' | 'admin' }): Promise<void>;
}

export const AUTH_STORE_PORT = Symbol('AUTH_STORE_PORT');
