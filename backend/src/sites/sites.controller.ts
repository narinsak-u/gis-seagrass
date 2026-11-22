import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Pool } from 'pg';

interface SiteSummary {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
}

interface SiteList {
  items: SiteSummary[];
  total: number;
  page: number;
}

const ALLOWED_QUERY_KEYS = ['status', 'province', 'q', 'page', 'pageSize'];
@Controller('sites')
export class SitesController {
  constructor(private readonly pool: Pool) {}

  @Get()
  async list(@Query() query: Record<string, unknown>): Promise<SiteList> {
    if (Object.keys(query).some((key) => !ALLOWED_QUERY_KEYS.includes(key))) throw new BadRequestException();
    if (query.status !== undefined && query.status !== 'active') throw new BadRequestException();

    const page = parsePositiveInteger(query.page, 1);
    const pageSize = parsePositiveInteger(query.pageSize, 20);
    if (page === undefined || pageSize === undefined || pageSize > 100
      || page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) {
      throw new BadRequestException();
    }
    const province = query.province;
    const search = query.q;
    if ((province !== undefined && (typeof province !== 'string' || province.length !== 2))
      || (search !== undefined && typeof search !== 'string')) {
      throw new BadRequestException();
    }

    const filters = ['deleted_at IS NULL'];
    const values: Array<string | number> = [];
    if (province !== undefined) {
      values.push(province);
      filters.push(`province_code = $${values.length}`);
    }
    if (search !== undefined && search.length > 0) {
      values.push(search);
      filters.push(`(strpos(lower(code), lower($${values.length})) > 0 OR strpos(lower(name), lower($${values.length})) > 0)`);
    }
    const where = filters.join(' AND ');
    const count = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM sites WHERE ${where}`,
      values,
    );
    const offset = (page - 1) * pageSize;
    const result = await this.pool.query<{
      code: string;
      name: string;
      province_code: string;
      area_rai: string;
      version: number;
    }>(
      `SELECT code, name, province_code, area_rai::text, version
         FROM sites WHERE ${where}
        ORDER BY code ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    return {
      items: result.rows.map((row) => ({
        code: row.code,
        name: row.name,
        province_code: row.province_code,
        area_rai: Number(row.area_rai),
        version: row.version,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      page,
    };
  }
}

function parsePositiveInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
