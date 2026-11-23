import { Module } from '@nestjs/common';
import { SITE_WRITE_PORT, type SiteWritePort } from '../application/site-write.port';
import { DrizzleSiteWriteStore } from './drizzle-site-write-store';

@Module({
  providers: [DrizzleSiteWriteStore, { provide: SITE_WRITE_PORT, useExisting: DrizzleSiteWriteStore }],
  exports: [SITE_WRITE_PORT],
})
export class SitesInfrastructureModule {}

export function createSiteWritePort(): SiteWritePort {
  return new DrizzleSiteWriteStore();
}


