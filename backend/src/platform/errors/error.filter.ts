import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { ApplicationError, isRecord } from '../../shared';

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
    const applicationError = exception instanceof ApplicationError ? exception : undefined;
    const status = applicationError
      ? applicationStatus(applicationError.code)
      : exception instanceof HttpException
        ? exception.getStatus()
        : isRecord(exception) && exception.status === 400 ? 400 : 500;

    let body: Record<string, unknown> = applicationError
      ? { code: applicationError.code, message: applicationError.message, details: applicationError.details }
      : {};
    if (!applicationError && exception instanceof HttpException) {
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
    } else if ((exception instanceof HttpException || applicationError) && status < 500) {
      error = {
        code: typeof body.code === 'string' ? body.code : 'HTTP_ERROR',
        message: typeof body.message === 'string'
          ? body.message
          : exception instanceof Error ? exception.message : 'Request failed',
        details: isRecord(body.details) ? body.details : {},
      };
    } else {
      error = { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} };
    }
    const envelope: ErrorEnvelope = { error };
    response.status(status).json(envelope);
  }
}

function applicationStatus(code: string): number {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'INVALID_GEOMETRY':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'SITE_NOT_FOUND':
    case 'SURVEY_NOT_FOUND':
      return 404;
    case 'DUPLICATE_CODE':
    case 'VERSION_CONFLICT':
    case 'SURVEYS_OUTSIDE':
    case 'SITE_HAS_SURVEYS':
      return 409;
    case 'OUTSIDE_COVERAGE':
    case 'OUTSIDE_SITE':
      return 422;
    default:
      return 500;
  }
}
