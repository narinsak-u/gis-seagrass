import { Module } from '@nestjs/common';
import { DrizzleSiteWriteStore } from './drizzle-site-write-store';
import { SITE_WRITE_PORT } from '../site-write.port';

@Module({
  providers: [DrizzleSiteWriteStore, { provide: SITE_WRITE_PORT, useExisting: DrizzleSiteWriteStore }],
  exports: [SITE_WRITE_PORT],
})
export class SiteWriteInfrastructureModule {}
