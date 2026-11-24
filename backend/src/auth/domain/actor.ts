export type ActorRole = 'viewer' | 'editor' | 'admin';

export interface AuthenticatedActor {
  id: string;
  email: string;
  role: ActorRole;
}
