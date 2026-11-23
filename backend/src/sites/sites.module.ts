import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SurveysModule } from '../surveys/surveys.module';
import { SiteSurveyCoordinator } from './site-survey.coordinator';
import { SitesController } from './sites.controller';
import { SitesGeoJsonController } from './sites.geojson.controller';

@Module({
  imports: [AuthModule, SurveysModule],
  controllers: [SitesController, SitesGeoJsonController],
  providers: [SiteSurveyCoordinator],
})
export class SitesModule {}
