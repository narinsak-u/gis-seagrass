import type { SiteWriteTransaction } from '../site-survey/transaction';
import type { SurveyInput } from './survey-validation';

export interface SurveyWritePort {
  siteId(tx: SiteWriteTransaction, id: string): Promise<string | null>;
  lock(tx: SiteWriteTransaction, id: string, siteId: string): Promise<boolean>;
  today(tx: SiteWriteTransaction): Promise<string>;
  hasSpecies(tx: SiteWriteTransaction, codes: string[]): Promise<boolean>;
  species(tx: SiteWriteTransaction, id: string): Promise<string[]>;
  create(tx: SiteWriteTransaction, siteId: string, input: SurveyInput, actorId: string): Promise<SurveyWriteResponse>;
  update(tx: SiteWriteTransaction, id: string, siteId: string, input: SurveyInput, actorId: string): Promise<SurveyWriteResponse>;
  remove(tx: SiteWriteTransaction, id: string): Promise<void>;
}

export interface SurveyWriteResponse {
  id: string;
  lon: number;
  lat: number;
  surveyed_on: string;
  cover_percent: number;
  species: string[];
  note: string | null;
  siteStatus: string;
}

export const SURVEY_WRITE_PORT = Symbol('SURVEY_WRITE_PORT');
