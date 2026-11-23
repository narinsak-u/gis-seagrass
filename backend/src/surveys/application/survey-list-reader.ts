import type { SurveyListReaderPort, SurveyPage } from './survey-list-reader.port';

export class SurveyListReader {
  constructor(private readonly surveys: SurveyListReaderPort) {}

  listBySiteCode(code: string, page: number, pageSize: number): Promise<SurveyPage | null> {
    return this.surveys.listBySiteCode(code, page, pageSize);
  }
}
