BEGIN;

DO $schema_catalog$
DECLARE
    missing_tables text;
BEGIN
    SELECT string_agg(required.name, ', ' ORDER BY required.name)
      INTO missing_tables
      FROM (VALUES ('users'), ('provinces'), ('species'), ('sites'), ('surveys'), ('survey_species')) AS required(name)
     WHERE to_regclass(format('public.%I', required.name)) IS NULL;

    IF missing_tables IS NOT NULL THEN
        RAISE EXCEPTION 'Schema missing required table(s): %', missing_tables;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM geometry_columns
         WHERE f_table_schema = 'public' AND f_table_name = 'provinces'
           AND f_geometry_column = 'geom' AND type = 'MULTIPOLYGON' AND srid = 4326
    ) THEN
        RAISE EXCEPTION 'provinces.geom must be geometry(MultiPolygon, 4326)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM geometry_columns
         WHERE f_table_schema = 'public' AND f_table_name = 'sites'
           AND f_geometry_column = 'geom' AND type = 'MULTIPOLYGON' AND srid = 4326
    ) THEN
        RAISE EXCEPTION 'sites.geom must be geometry(MultiPolygon, 4326)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM geometry_columns
         WHERE f_table_schema = 'public' AND f_table_name = 'surveys'
           AND f_geometry_column = 'geom' AND type = 'POINT' AND srid = 4326
    ) THEN
        RAISE EXCEPTION 'surveys.geom must be geometry(Point, 4326)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.users'::regclass AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) ILIKE '%role%'
    ) THEN RAISE EXCEPTION 'users.role check constraint is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.sites'::regclass AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) ILIKE '%version%'
    ) THEN RAISE EXCEPTION 'sites.version check constraint is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.surveys'::regclass AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) ILIKE '%cover_percent%'
    ) THEN RAISE EXCEPTION 'surveys.cover_percent check constraint is missing'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.sites'::regclass AND c.confrelid = 'public.provinces'::regclass
           AND c.contype = 'f' AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'province_code')]::smallint[]
    ) THEN RAISE EXCEPTION 'sites.province_code foreign key is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.surveys'::regclass AND c.confrelid = 'public.sites'::regclass
           AND c.contype = 'f' AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'site_id')]::smallint[]
           AND c.confdeltype <> 'c'
    ) THEN RAISE EXCEPTION 'surveys.site_id foreign key must restrict site deletion'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.survey_species'::regclass AND c.confrelid = 'public.surveys'::regclass
           AND c.contype = 'f' AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'survey_id')]::smallint[]
    ) THEN RAISE EXCEPTION 'survey_species.survey_id foreign key is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.survey_species'::regclass AND c.confrelid = 'public.species'::regclass
           AND c.contype = 'f' AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'species_code')]::smallint[]
    ) THEN RAISE EXCEPTION 'survey_species.species_code foreign key is missing'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
         WHERE i.indrelid = 'public.sites'::regclass AND i.indisunique AND i.indpred IS NOT NULL
           AND i.indnatts = 1 AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'code')
           AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%deleted_at IS NULL%'
    ) THEN RAISE EXCEPTION 'Active site-code unique index is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
         WHERE i.indrelid = 'public.surveys'::regclass AND i.indisunique AND i.indpred IS NOT NULL
           AND i.indnatts = 1 AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'survey_ref')
           AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%survey_ref IS NOT NULL%'
    ) THEN RAISE EXCEPTION 'Present survey-reference unique index is missing'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_am am ON am.oid = idx.relam
         WHERE i.indrelid = 'public.provinces'::regclass AND am.amname = 'gist'
           AND i.indnatts = 1 AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'geom')
    ) THEN RAISE EXCEPTION 'GiST index on provinces.geom is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_am am ON am.oid = idx.relam
         WHERE i.indrelid = 'public.sites'::regclass AND am.amname = 'gist'
           AND i.indnatts = 1 AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'geom')
    ) THEN RAISE EXCEPTION 'GiST index on sites.geom is missing'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_am am ON am.oid = idx.relam
         WHERE i.indrelid = 'public.surveys'::regclass AND am.amname = 'gist'
           AND i.indnatts = 1 AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'geom')
    ) THEN RAISE EXCEPTION 'GiST index on surveys.geom is missing'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
         WHERE i.indrelid = 'public.surveys'::regclass AND i.indnatts = 3
           AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'site_id')
           AND i.indkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'surveyed_on')
           AND i.indkey[2] = (SELECT attnum FROM pg_attribute WHERE attrelid = i.indrelid AND attname = 'id')
           AND (i.indoption[1] & 1) = 1 AND (i.indoption[2] & 1) = 1
    ) THEN RAISE EXCEPTION 'Descending surveys(site_id, surveyed_on, id) index is missing'; END IF;
END;
$schema_catalog$;

DO $schema_behavior$
DECLARE
    province_code char(2);
    n integer;
    site_code text := 'schema-check-' || gen_random_uuid()::text;
    duplicate_site_code text := 'schema-check-duplicate-' || gen_random_uuid()::text;
    site_id bigint;
    now_at timestamptz := now();
BEGIN
    BEGIN
        INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
        VALUES (gen_random_uuid(), gen_random_uuid()::text || '@schema-check.invalid', 'test-hash', 'invalid-role', now_at, now_at);
        RAISE EXCEPTION 'users.role accepted an invalid value';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    FOR n IN 0..675 LOOP
        province_code := chr(65 + n / 26) || chr(65 + n % 26);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM provinces WHERE code = province_code);
    END LOOP;
    IF EXISTS (SELECT 1 FROM provinces WHERE code = province_code) THEN
        RAISE EXCEPTION 'Could not allocate a temporary two-letter province code';
    END IF;

    INSERT INTO provinces (code, name_th, geom)
    VALUES (province_code, 'Schema test', ST_GeomFromText('MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))', 4326));

    BEGIN
        INSERT INTO sites (code, name, province_code, geom, area_rai, version, created_at, updated_at)
        VALUES (site_code, 'Schema test invalid version', province_code,
                ST_GeomFromText('MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))', 4326), 1, 0, now_at, now_at);
        RAISE EXCEPTION 'sites.version accepted zero';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO sites (code, name, province_code, geom, area_rai, created_at, updated_at)
    VALUES (site_code, 'Schema test site', province_code,
            ST_GeomFromText('MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))', 4326), 1, now_at, now_at)
    RETURNING id INTO site_id;

    BEGIN
        INSERT INTO sites (code, name, province_code, geom, area_rai, created_at, updated_at)
        VALUES (site_code, 'Schema test duplicate', province_code,
                ST_GeomFromText('MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))', 4326), 1, now_at, now_at);
        RAISE EXCEPTION 'Duplicate active site code was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    INSERT INTO sites (code, name, province_code, geom, area_rai, created_at, updated_at)
    VALUES (duplicate_site_code, 'Schema test soft-deleted duplicate', province_code,
            ST_GeomFromText('MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))', 4326), 1, now_at, now_at);
    UPDATE sites SET deleted_at = now_at WHERE code = duplicate_site_code;
    INSERT INTO sites (code, name, province_code, geom, area_rai, created_at, updated_at)
    VALUES (duplicate_site_code, 'Schema test reused code', province_code,
            ST_GeomFromText('MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))', 4326), 1, now_at, now_at);

    BEGIN
        INSERT INTO surveys (site_id, geom, surveyed_on, cover_percent, created_at, updated_at)
        VALUES (site_id, ST_GeomFromText('POINT(100.5 10.5)', 4326), CURRENT_DATE, 101, now_at, now_at);
        RAISE EXCEPTION 'surveys.cover_percent accepted a value above 100';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO surveys (site_id, geom, surveyed_on, cover_percent, created_at, updated_at)
    VALUES (site_id, ST_GeomFromText('POINT(100.5 10.5)', 4326), CURRENT_DATE, 50, now_at, now_at)
    RETURNING id INTO survey_id;

    BEGIN
        DELETE FROM sites WHERE id = site_id;
        RAISE EXCEPTION 'Deleting a site cascaded into its survey';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
END;
$schema_behavior$;

ROLLBACK;
