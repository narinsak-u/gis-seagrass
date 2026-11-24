declare const siteWriteTransactionBrand: unique symbol;

export type SiteWriteTransaction = { readonly [siteWriteTransactionBrand]: true };

export interface SiteSurveyTransactionRunner {
  run<T>(work: (tx: SiteWriteTransaction) => Promise<T>): Promise<T>;
}

export const SITE_SURVEY_TRANSACTION_RUNNER = Symbol('SITE_SURVEY_TRANSACTION_RUNNER');
