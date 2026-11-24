import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { signAccessToken } from './auth-token';
import type { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthController } from '../presentation/auth.controller';

const testSecret = 'isolated-integration-signing-secret-32-bytes';

test('AuthService.resolveAccessToken includes email and AuthController.me returns only { email, role }', async () => {
  process.env.JWT_SECRET = testSecret;
  const actorId = randomUUID();
  const fakeRepository: AuthRepository = {
    async findByEmail() { return null; },
    async findActiveActorById(id) {
      return id === actorId ? { id: actorId, email: 'viewer@example.test', role: 'viewer' } : null;
    },
    async hasEmail() { return false; },
    async insertIfAbsent() {},
  };
  const service = new AuthService(fakeRepository);
  const controller = new AuthController(service);
  const actor = await service.resolveAccessToken(signAccessToken(actorId));
  expect(actor).toStrictEqual({ id: actorId, email: 'viewer@example.test', role: 'viewer' });
  expect(controller.me({ user: actor!, headers: {} })).toStrictEqual({ email: 'viewer@example.test', role: 'viewer' });
});
