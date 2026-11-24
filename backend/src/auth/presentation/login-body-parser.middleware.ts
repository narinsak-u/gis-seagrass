import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureLoginBodyParsing(app: NestExpressApplication): void {
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
  app.use(loginBodyParserErrorMiddleware);
}

function loginBodyParserErrorMiddleware(
  error: unknown,
  request: { method: string; path: string; body: unknown },
  _response: unknown,
  next: (error?: unknown) => void,
): void {
  if (request.method === 'POST' && /^\/auth\/login\/?$/i.test(request.path)) {
    request.body = {};
    return next();
  }
  next(error);
}
