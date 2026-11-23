import { Module } from '@nestjs/common';
import { AuthController, requireJwtSecret, seedDevelopmentAccounts } from './auth.controller';
import { AuthGuard } from './auth.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}

export { requireJwtSecret, seedDevelopmentAccounts };
