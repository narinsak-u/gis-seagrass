import { Module } from '@nestjs/common';
import { SiteWriteInfrastructureModule } from '../sites/infrastructure/site-write.module';
import { SurveyCoordinationInfrastructureModule } from '../surveys/infrastructure/survey-coordination.module';
import { SurveyStatusReader } from '../surveys/survey-status-reader';
import { SiteSurveyCoordinator } from './site-survey.coordinator';

@Module({
  imports: [SiteWriteInfrastructureModule, SurveyCoordinationInfrastructureModule],
  providers: [SurveyStatusReader, SiteSurveyCoordinator],
  exports: [SiteSurveyCoordinator],
})
export class SiteSurveyModule {}
