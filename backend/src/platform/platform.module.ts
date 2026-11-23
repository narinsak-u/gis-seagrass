import { BadRequestException, Inject, Injectable, type DynamicModule, Module, type OnApplicationShutdown, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { DATABASE_PROVIDER, type DatabaseProvider } from './database/provider';
import { ApiErrorFilter } from './errors/error.filter';
import { HealthController } from './health/health.controller';

@Injectable()
class CloseDatabaseOnShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_PROVIDER) private readonly database: DatabaseProvider) {}

  onApplicationShutdown(): Promise<void> {
    return this.database.close();
  }
}

@Module({})
export class PlatformModule {
  static register(database: DatabaseProvider): DynamicModule {
    return {
      module: PlatformModule,
      imports: [DatabaseModule.register(database)],
      controllers: [HealthController],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        {
          provide: APP_PIPE,
          useFactory: () => new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
            transformOptions: { enableImplicitConversion: false },
            exceptionFactory: () => new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              details: {},
            }),
          }),
        },
        CloseDatabaseOnShutdown,
      ],
    };
  }
}
