export interface SurveyListItem {
  id: string;
  lon: number;
  lat: number;
  surveyed_on: string;
  cover_percent: number;
  species: string[];
  note: string | null;
  created_by: string | null;
}

export interface SurveyPage {
  items: SurveyListItem[];
  total: number;
  page: number;
}

export interface SurveyListReaderPort {
  listBySiteCode(code: string, page: number, pageSize: number): Promise<SurveyPage | null>;
}

export const SURVEY_LIST_READER_PORT = Symbol('SURVEY_LIST_READER_PORT');
