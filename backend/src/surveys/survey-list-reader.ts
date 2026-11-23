import { Inject, Injectable } from '@nestjs/common';
import { SURVEY_LIST_READER_PORT, type SurveyListReaderPort, type SurveyPage } from './survey-list-reader.port';

@Injectable()
export class SurveyListReader {
  constructor(@Inject(SURVEY_LIST_READER_PORT) private readonly surveys: SurveyListReaderPort) {}

  listBySiteCode(code: string, page: number, pageSize: number): Promise<SurveyPage | null> {
    return this.surveys.listBySiteCode(code, page, pageSize);
  }
}
