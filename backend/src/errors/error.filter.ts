import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { isRecord } from '../import/guards';

interface HttpResponse {
  status(code: number): this;
  json(body: unknown): void;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : isRecord(exception) && exception.status === 400 ? 400 : 500;

    let body: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      const exceptionBody: unknown = exception.getResponse();
      if (isRecord(exceptionBody)) body = exceptionBody;
    }

    let error: ErrorEnvelope['error'];
    if (status === 400 || status === 404) {
      const fallback = status === 400
        ? { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} }
        : { code: 'NOT_FOUND', message: 'Not Found', details: {} };
      error = typeof body.code === 'string'
        ? {
          code: body.code,
          message: typeof body.message === 'string'
            ? body.message
            : exception instanceof HttpException ? exception.message : fallback.message,
          details: isRecord(body.details) ? body.details : {},
        }
        : fallback;
    } else if (exception instanceof HttpException && status < 500) {
      error = {
        code: typeof body.code === 'string' ? body.code : 'HTTP_ERROR',
        message: typeof body.message === 'string' ? body.message : exception.message,
        details: isRecord(body.details) ? body.details : {},
      };
    } else {
      error = { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} };
    }
    const envelope: ErrorEnvelope = { error };
    response.status(status).json(envelope);
  }
}
