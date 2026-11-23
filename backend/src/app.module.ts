import { BadRequestException, Inject, Injectable, type DynamicModule, Module, type OnApplicationShutdown, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ApiErrorFilter } from './errors/error.filter';
import { DatabaseModule } from './database/database.module';
import { DATABASE_PROVIDER, type DatabaseProvider } from './database/provider';
import { HealthController } from './health/health.controller';
import { SitesModule } from './sites/sites.module';
import { SurveysModule } from './surveys/surveys.module';

@Injectable()
class CloseDatabaseOnShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_PROVIDER) private readonly database: DatabaseProvider) {}

  onApplicationShutdown(): Promise<void> {
    return this.database.close();
  }
}

@Module({})
export class AppModule {
  static register(database: DatabaseProvider): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.register(database), AuthModule, SitesModule, SurveysModule],
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
