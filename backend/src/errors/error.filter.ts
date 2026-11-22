import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { isRecord } from '../import/guards';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : isRecord(exception) && exception.status === 400 ? 400 : 500;

    let body: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      const exceptionBody: unknown = exception.getResponse();
      if (isRecord(exceptionBody)) body = exceptionBody;
    }

    let error: ErrorEnvelope['error'];
    if (status === 400) {
      error = { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} };
    } else if (status === 404) {
      error = { code: 'NOT_FOUND', message: 'Not Found', details: {} };
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
