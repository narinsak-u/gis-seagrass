import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule } from '../site-survey/site-survey.module';
import { SitesController } from './sites.controller';
import { SitesGeoJsonController } from './sites.geojson.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule],
  controllers: [SitesController, SitesGeoJsonController],
})
export class SitesModule {}
