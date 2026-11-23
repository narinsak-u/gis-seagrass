DROP INDEX uq_sites_active_code;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_sites_code ON sites(code);
