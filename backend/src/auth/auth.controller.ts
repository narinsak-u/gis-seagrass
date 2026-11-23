import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { isRecord } from '../domain/guards';
import { AuthService } from './auth-service';

const LOGIN_ERROR_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'details'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } },
    },
  },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Signed access token', schema: { type: 'object', required: ['access_token', 'token_type', 'expires_in'], properties: { access_token: { type: 'string' }, token_type: { type: 'string', enum: ['Bearer'] }, expires_in: { type: 'integer', enum: [900] } } } })
  @ApiResponse({ status: 400, description: 'Malformed credentials', schema: LOGIN_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'Invalid credentials', schema: LOGIN_ERROR_SCHEMA })
  login(@Body() body: unknown): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    if (!isRecord(body) || Object.keys(body).length !== 2 || typeof body.email !== 'string' || !body.email
      || typeof body.password !== 'string' || !body.password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid login request', details: {} });
    }
    return this.auth.login(body.email, body.password);
  }
}
