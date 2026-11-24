import type { SiteStatus } from "./status";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
  SiteGeometry,
} from "./types";

export interface SiteFilterCriteria {
  province: string;
  siteStatus: SiteStatus | "";
  search: string;
}

export const EMPTY_SITE_FILTERS: SiteFilterCriteria = {
  province: "",
  siteStatus: "",
  search: "",
};

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export interface ProvinceOption {
  code: string;
  label: string;
}

export type ProvinceNameLookup =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>;

export function hasActiveSiteFilters(criteria: SiteFilterCriteria): boolean {
  return (
    criteria.province.trim().length > 0 ||
    criteria.siteStatus.length > 0 ||
    criteria.search.trim().length > 0
  );
}

export function filterSiteFeatures(
  features: readonly SiteFeature[],
  criteria: SiteFilterCriteria,
): SiteFeature[] {
  const provinceFilter = criteria.province.trim();
  const statusFilter = criteria.siteStatus;
  const searchQuery = criteria.search.trim().toLocaleLowerCase();

  return features.filter((feature) => {
    const props = feature.properties;

    if (provinceFilter && props.province_code !== provinceFilter) {
      return false;
    }

    if (statusFilter && props.siteStatus !== statusFilter) {
      return false;
    }

    if (searchQuery) {
      const codeMatch = props.code.toLocaleLowerCase().includes(searchQuery);
      const nameMatch = props.name.toLocaleLowerCase().includes(searchQuery);
      if (!codeMatch && !nameMatch) {
        return false;
      }
    }

    return true;
  });
}

export function filterSiteCollection(
  collection: SiteFeatureCollection | null,
  criteria: SiteFilterCriteria,
): SiteFeatureCollection | null {
  if (!collection) return null;
  return {
    type: "FeatureCollection",
    features: filterSiteFeatures(collection.features, criteria),
  };
}

export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): PaginatedResult<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage || 1)));

  if (totalItems === 0) {
    return {
      items: [],
      page: 1,
      pageSize: safePageSize,
      totalItems: 0,
      totalPages: 1,
      startIndex: 0,
      endIndex: 0,
    };
  }

  const offset = (page - 1) * safePageSize;
  const slice = items.slice(offset, offset + safePageSize);
  return {
    items: slice,
    page,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    startIndex: offset + 1,
    endIndex: offset + slice.length,
  };
}

export function findPageForSiteCode(
  features: readonly SiteFeature[],
  siteCode: string,
  pageSize: number,
): number | null {
  const index = features.findIndex((feature) => feature.properties.code === siteCode);
  if (index < 0) return null;
  const safePageSize = Math.max(1, Math.floor(pageSize));
  return Math.floor(index / safePageSize) + 1;
}

function lookupProvinceName(
  code: string,
  provinceNames?: ProvinceNameLookup,
): string | undefined {
  if (!provinceNames) return undefined;
  const raw =
    provinceNames instanceof Map
      ? provinceNames.get(code)
      : (provinceNames as Readonly<Record<string, string>>)[code];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function formatProvinceLabel(
  code: string,
  provinceNames?: ProvinceNameLookup,
): string {
  const name = lookupProvinceName(code, provinceNames);
  return name ? `${name} (${code})` : `Province ${code}`;
}

function sortProvinceCodes(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function mergeKnownProvinceCodes(
  previousKnownCodes: readonly string[],
  viewportFeatures: readonly SiteFeature[],
  isProvinceFiltered: boolean,
): string[] {
  const viewportCodes = viewportFeatures
    .map((feature) => feature.properties.province_code.trim())
    .filter((code) => code.length > 0);

  if (!isProvinceFiltered) {
    return sortProvinceCodes(viewportCodes);
  }

  return sortProvinceCodes([...previousKnownCodes, ...viewportCodes]);
}

export interface DeriveProvinceOptionsParams {
  knownCodes: readonly string[];
  viewportFeatures: readonly SiteFeature[];
  activeProvince: string;
  provinceNames?: ProvinceNameLookup;
}

export function deriveProvinceOptions({
  knownCodes,
  viewportFeatures,
  activeProvince,
  provinceNames,
}: DeriveProvinceOptionsParams): ProvinceOption[] {
  const combined: string[] = [...knownCodes];

  for (const feature of viewportFeatures) {
    const code = feature.properties.province_code.trim();
    if (code) combined.push(code);
  }

  const trimmedActive = activeProvince.trim();
  if (trimmedActive) {
    combined.push(trimmedActive);
  }

  return sortProvinceCodes(combined).map((code) => ({
    code,
    label: formatProvinceLabel(code, provinceNames),
  }));
}

export function computeSiteBounds(geometry: SiteGeometry): BboxBounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const visitRing = (ring: number[][]) => {
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = point[0];
      const lat = point[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][];
    for (const ring of rings) {
      visitRing(ring);
    }
  } else if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as number[][][][];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        visitRing(ring);
      }
    }
  }

  if (
    !Number.isFinite(minLon) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLon) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  return { minLon, minLat, maxLon, maxLat };
}
