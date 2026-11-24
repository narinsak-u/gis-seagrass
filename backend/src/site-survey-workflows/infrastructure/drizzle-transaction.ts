import type { DatabaseProvider } from '../../platform/database';
import type { SiteWriteTransaction } from '../application/transaction-runner.port';

export type DrizzleTransaction = Parameters<Parameters<DatabaseProvider['db']['transaction']>[0]>[0];

export function asDrizzleTransaction(transaction: SiteWriteTransaction): DrizzleTransaction {
  return transaction as unknown as DrizzleTransaction;
}
