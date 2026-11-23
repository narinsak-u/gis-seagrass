CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('viewer', 'editor', 'admin'))
);
--> statement-breakpoint
CREATE TABLE provinces (
  code varchar(2) PRIMARY KEY,
  name_th text NOT NULL,
  geom geometry(MultiPolygon,4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE species (
  code text PRIMARY KEY,
  name_th text NOT NULL,
  name_sci text NOT NULL
);
--> statement-breakpoint
CREATE TABLE sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  province_code varchar(2) NOT NULL REFERENCES provinces(code) ON DELETE RESTRICT,
  geom geometry(MultiPolygon,4326) NOT NULL,
  area_rai numeric(14,2) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT sites_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE surveys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  survey_ref text,
  geom geometry(Point,4326) NOT NULL,
  surveyed_on date NOT NULL,
  cover_percent numeric(5,2) NOT NULL,
  note text,
  photo_key text,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surveys_cover_percent_check CHECK (cover_percent BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE survey_species (
  survey_id bigint NOT NULL REFERENCES surveys(id) ON DELETE RESTRICT,
  species_code text NOT NULL REFERENCES species(code) ON DELETE RESTRICT,
  PRIMARY KEY (survey_id, species_code)
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_sites_active_code ON sites(code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_surveys_ref ON surveys(survey_ref) WHERE survey_ref IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_provinces_geom ON provinces USING GIST (geom);
--> statement-breakpoint
CREATE INDEX idx_sites_geom ON sites USING GIST (geom);
--> statement-breakpoint
CREATE INDEX idx_surveys_geom ON surveys USING GIST (geom);
--> statement-breakpoint
CREATE INDEX idx_surveys_site_date ON surveys(site_id, surveyed_on DESC, id DESC);
--> statement-breakpoint
