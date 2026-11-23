import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../domain/application-error';
import type { SiteWriteTransaction } from '../site-survey/transaction';
import { SiteSurveyCoordinator } from '../site-survey/site-survey.coordinator';
import { SURVEY_WRITE_PORT, type SurveyInput, type SurveyWritePort } from './survey-write.port';

@Injectable()
export class SurveyWriter {
  constructor(
    private readonly coordinator: SiteSurveyCoordinator,
    @Inject(SURVEY_WRITE_PORT) private readonly surveys: SurveyWritePort,
  ) {}

  create(code: string, input: SurveyInput, actorId: string) {
    return this.coordinator.transaction(async (tx) => {
      const site = await this.coordinator.lockSiteForSurvey(tx, code, input.lon!, input.lat!);
      if (!site) throw new ApplicationError('SITE_NOT_FOUND', 'Site not found');
      if (!site.within) throw outsideSite();
      await this.validateDateAndSpecies(tx, input.surveyed_on!, input.species!);
      return this.surveys.create(tx, site.id, input, actorId);
    });
  }

  async import(code: string, ref: string, input: SurveyInput): Promise<'SKIPPED' | 'UNKNOWN_SPECIES' | 'FUTURE_DATE' | 'SITE_NOT_FOUND' | 'OUTSIDE_SITE' | 'INSERTED'> {
    return this.coordinator.transaction(async (tx) => {
      if (await this.surveys.existsRef(tx, ref)) return 'SKIPPED';
      if (!(await this.surveys.hasSpecies(tx, input.species!))) return 'UNKNOWN_SPECIES';
      if (input.surveyed_on! > await this.surveys.today(tx)) return 'FUTURE_DATE';
      const site = await this.coordinator.lockSiteForSurvey(tx, code, input.lon!, input.lat!);
      if (!site) return 'SITE_NOT_FOUND';
      if (!site.within) return 'OUTSIDE_SITE';
      return await this.surveys.import(tx, site.id, ref, input) ? 'INSERTED' : 'SKIPPED';
    });
  }

  hasReference(ref: string): Promise<boolean> {
    return this.coordinator.transaction((tx) => this.surveys.existsRef(tx, ref));
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
    if (date > await this.surveys.today(tx)) throw new ApplicationError('VALIDATION_ERROR', 'Invalid request');
    await this.validateSpecies(tx, species);
  }

  private async validateSpecies(tx: SiteWriteTransaction, species: string[]): Promise<void> {
    if (!(await this.surveys.hasSpecies(tx, species))) {
      throw new ApplicationError('VALIDATION_ERROR', 'Unknown species code');
    }
  }
}

function surveyNotFound(): ApplicationError {
  return new ApplicationError('SURVEY_NOT_FOUND', 'Survey not found');
}

function outsideSite(): ApplicationError {
  return new ApplicationError('OUTSIDE_SITE', 'Survey location is more than 50 meters from Site');
}
