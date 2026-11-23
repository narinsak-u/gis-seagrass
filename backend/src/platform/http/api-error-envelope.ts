import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorEnvelope {
  @ApiProperty({ type: 'object', required: ['code', 'message', 'details'], properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  } })
  error!: { code: string; message: string; details: Record<string, unknown> };
}
