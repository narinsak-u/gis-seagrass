import { queryOptions } from "@tanstack/react-query";
import { fetchActiveSitesGeoJson } from "./api";
import type { BboxBounds, SiteFeatureCollection } from "./types";

export type ViewportLoadStatus = "idle" | "invalid" | "loading" | "ready" | "empty" | "error";

export interface ViewportErrorInfo {
  code: string;
  message: string;
  status?: number;
}

export interface ViewportSitesState {
  status: ViewportLoadStatus;
  data: SiteFeatureCollection | null;
  error: ViewportErrorInfo | null;
  bbox: BboxBounds | null;
  bboxString: string | null;
  province?: string;
}

export interface TimerScheduler {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}


export function siteViewportQueryOptions(bbox: string, province?: string) {
  return queryOptions({
    queryKey: ["sites", "viewport", bbox, province, "active"],
    queryFn: ({ signal }) => fetchActiveSitesGeoJson({ bbox, province, signal }),
  });
}

export function createViewportDebouncer(
  onSettle: (bounds: BboxBounds) => void,
  delayMs = 250,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(bounds: BboxBounds) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        onSettle(bounds);
      }, delayMs);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

export function isValidBboxBounds(bounds: BboxBounds): boolean {
  return (
    Number.isFinite(bounds.minLon) &&
    Number.isFinite(bounds.minLat) &&
    Number.isFinite(bounds.maxLon) &&
    Number.isFinite(bounds.maxLat) &&
    bounds.minLon >= -180 &&
    bounds.minLat >= -90 &&
    bounds.maxLon <= 180 &&
    bounds.maxLat <= 90 &&
    bounds.minLon < bounds.maxLon &&
    bounds.minLat < bounds.maxLat &&
    !(
      bounds.minLon === -180 &&
      bounds.minLat === -90 &&
      bounds.maxLon === 180 &&
      bounds.maxLat === 90
    )
  );
}

export function normalizeBboxBounds(bounds: BboxBounds): BboxBounds {
  return {
    minLon: roundCoord(clamp(bounds.minLon, -180, 180)),
    minLat: roundCoord(clamp(bounds.minLat, -90, 90)),
    maxLon: roundCoord(clamp(bounds.maxLon, -180, 180)),
    maxLat: roundCoord(clamp(bounds.maxLat, -90, 90)),
  };
}

export function formatBbox(bounds: BboxBounds): string {
  const normalized = normalizeBboxBounds(bounds);
  return `${normalized.minLon},${normalized.minLat},${normalized.maxLon},${normalized.maxLat}`;
}
