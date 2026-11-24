import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { AuthService } from '../application/auth.service';
import type { ActorRole } from '../domain/actor';
import { LoginDto } from './auth.dto';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';

const AUTH_ERROR_SCHEMA: SchemaObject = {
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
  @ApiResponse({ status: 400, description: 'Malformed credentials', schema: AUTH_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'Invalid credentials', schema: AUTH_ERROR_SCHEMA })
  login(@Body() body: LoginDto): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Return the current authenticated user email and role' })
  @ApiResponse({
    status: 200,
    description: 'Current authenticated user identity',
    schema: {
      type: 'object',
      required: ['email', 'role'],
      properties: {
        email: { type: 'string', format: 'email' },
        role: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing, invalid, expired, or inactive token', schema: AUTH_ERROR_SCHEMA })
  me(@Req() request: AuthenticatedRequest): { email: string; role: ActorRole } {
    return { email: request.user.email, role: request.user.role };
  }
}
