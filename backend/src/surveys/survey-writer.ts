import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { SiteWriteTransaction } from '../site-survey/transaction';
import { SiteSurveyCoordinator } from '../site-survey/site-survey.coordinator';
import { SURVEY_WRITE_PORT, type SurveyWritePort } from './survey-write.port';
import { validateSurveyDateAgainstToday, type SurveyInput } from './survey-validation';

@Injectable()
export class SurveyWriter {
  constructor(
    private readonly coordinator: SiteSurveyCoordinator,
    @Inject(SURVEY_WRITE_PORT) private readonly surveys: SurveyWritePort,
  ) {}

  create(code: string, input: SurveyInput, actorId: string) {
    return this.coordinator.transaction(async (tx) => {
      const site = await this.coordinator.lockSiteForSurvey(tx, code, input.lon!, input.lat!);
      if (!site) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
      if (!site.within) throw outsideSite();
      await this.validateDateAndSpecies(tx, input.surveyed_on!, input.species!);
      return this.surveys.create(tx, site.id, input, actorId);
    });
  }

  update(id: string, input: SurveyInput, actorId: string) {
    return this.coordinator.transaction(async (tx) => {
      const siteId = await this.surveys.siteId(tx, id);
      if (!siteId) throw surveyNotFound();
      if (!(await this.coordinator.lockActiveSite(tx, siteId))) throw surveyNotFound();
      if (!(await this.surveys.lock(tx, id, siteId))) throw surveyNotFound();
      if (input.lon !== undefined && !(await this.coordinator.siteWithinDistance(tx, siteId, input.lon, input.lat!))) throw outsideSite();
      if (input.surveyed_on !== undefined) {
        await this.validateDateAndSpecies(tx, input.surveyed_on, input.species ?? (await this.surveys.species(tx, id)));
      } else if (input.species !== undefined) await this.validateSpecies(tx, input.species);
      return this.surveys.update(tx, id, siteId, input, actorId);
    });
  }

  remove(id: string): Promise<void> {
    return this.coordinator.transaction(async (tx) => {
      const siteId = await this.surveys.siteId(tx, id);
      if (!siteId) throw surveyNotFound();
      if (!(await this.coordinator.lockActiveSite(tx, siteId))) throw surveyNotFound();
      if (!(await this.surveys.lock(tx, id, siteId))) throw surveyNotFound();
      await this.surveys.remove(tx, id);
    });
  }
  private async validateDateAndSpecies(tx: SiteWriteTransaction, date: string, species: string[]): Promise<void> {
    validateSurveyDateAgainstToday(date, await this.surveys.today(tx));
    await this.validateSpecies(tx, species);
  }

  private async validateSpecies(tx: SiteWriteTransaction, species: string[]): Promise<void> {
    if (!(await this.surveys.hasSpecies(tx, species))) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown species code', details: {} });
    }
  }
}

function surveyNotFound(): NotFoundException {
  return new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
}

function outsideSite(): UnprocessableEntityException {
  return new UnprocessableEntityException({ code: 'OUTSIDE_SITE', message: 'Survey location is more than 50 meters from Site', details: {} });
}
