import type { DatabaseProvider } from '../database/provider';

export type SiteWriteTransaction = Parameters<Parameters<DatabaseProvider['db']['transaction']>[0]>[0];
