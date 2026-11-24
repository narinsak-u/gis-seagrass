import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureLoginBodyParsing(app: NestExpressApplication): void {
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
  app.use(malformedLoginJsonMiddleware);
}

export function malformedLoginJsonMiddleware(
  error: unknown,
  request: { method: string; path: string; body: unknown },
  _response: unknown,
  next: (error?: unknown) => void,
): void {
  if (request.method === 'POST' && /^\/auth\/login\/?$/.test(request.path)
    && typeof error === 'object' && error !== null && 'type' in error
    && error.type === 'entity.parse.failed') {
    request.body = {};
    return next();
  }
  next(error);
}
