import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../../platform/database';
import { SITE_SURVEY_TRANSACTION_RUNNER, type SiteSurveyTransactionRunner, type SiteWriteTransaction } from '../../application/contracts/transaction-runner';

@Injectable()
export class DrizzleSiteSurveyTransactionRunner implements SiteSurveyTransactionRunner {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  run<T>(work: (tx: SiteWriteTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx as unknown as SiteWriteTransaction));
  }
}

export const SITE_SURVEY_TRANSACTION_RUNNER_PROVIDER = {
  provide: SITE_SURVEY_TRANSACTION_RUNNER,
  useExisting: DrizzleSiteSurveyTransactionRunner,
};

export function createSiteSurveyTransactionRunner(db: DatabaseProvider['db']): SiteSurveyTransactionRunner {
  return new DrizzleSiteSurveyTransactionRunner(db);
}
