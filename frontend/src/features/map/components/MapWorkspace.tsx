"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as maplibregl from "maplibre-gl";
import { ApiClientError } from "@/src/lib/api";
import {
  provinceViewportQueryOptions,
  type ViewportProvincesState,
} from "@/src/features/provinces/provinces-viewport";
import type { ProvinceFeature } from "@/src/features/provinces/types";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
} from "@/src/features/sites/types";
import {
  createViewportDebouncer,
  formatBbox,
  isValidBboxBounds,
  normalizeBboxBounds,
  siteViewportQueryOptions,
  type ViewportSitesState,
} from "@/src/features/sites/viewport";
import type { SurveyPointFeatureCollection } from "@/src/features/surveys/types";
import { SeagrassMap } from "./SeagrassMap";
import { MapWorkspaceStatus } from "./MapWorkspaceStatus";

export interface MapWorkspaceProps {
  /** Extension slot for Ticket 04 authentication bar / identity display. */
  headerActions?: ReactNode;
  /** Extension slot for Ticket 02 synchronized viewport table, filters, and Site detail panel. */
  sidePanel?: ReactNode;
  /** Optional province filter forwarded to /api/sites.geojson?province=... (Ticket 02). */
  provinceFilter?: string;
  /** Optional client-side filtered GeoJSON override for map rendering (Ticket 02). */
  visibleSitesOverride?: SiteFeatureCollection | null;
  /** Optional selected Site code for polygon highlighting (Ticket 02). */
  selectedSiteCode?: string | null;
  /** Optional selected-Site Survey points plotted above Site polygons (Ticket 05). */
  surveyPoints?: SurveyPointFeatureCollection | null;
  /** Callback when a Site polygon is clicked on the map (Ticket 02). */
  onSelectSite?: (feature: SiteFeature) => void;
  /** Callback when the MapLibre instance finishes initial load (Tickets 02, 03, 05). */
  onMapReady?: (map: maplibregl.Map) => void;
  /** Callback whenever viewport sites state updates (Ticket 02). */
  onViewportStateChange?: (state: ViewportSitesState) => void;
  /** Callback whenever map viewport bounds settle (Ticket 03 Province boundaries). */
  onViewportBoundsChange?: (bounds: BboxBounds) => void;
  /** Incrementing signal from sidePanel to retry the active viewport request. */
  retrySignal?: number;
  /** Callback whenever viewport Province features load so filters can enrich labels (Ticket 02). */
  onProvincesChange?: (provinces: ProvinceFeature[]) => void;
}



export function MapWorkspace({
  headerActions,
  sidePanel,
  provinceFilter,
  visibleSitesOverride,
  selectedSiteCode = null,
  surveyPoints = null,
  onSelectSite,
  onMapReady,
  onViewportStateChange,
  onViewportBoundsChange,
  retrySignal = 0,
  onProvincesChange,
}: MapWorkspaceProps) {
  const [settledBounds, setSettledBounds] = useState<BboxBounds | null>(null);
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const [resetViewSignal, setResetViewSignal] = useState(0);

  const onViewportStateChangeRef = useRef(onViewportStateChange);
  const onViewportBoundsChangeRef = useRef(onViewportBoundsChange);
  const onProvincesChangeRef = useRef(onProvincesChange);
  const viewportDebouncerRef = useRef<ReturnType<typeof createViewportDebouncer> | null>(null);
  if (!viewportDebouncerRef.current) {
    viewportDebouncerRef.current = createViewportDebouncer((bounds) => {
      setSettledBounds(isValidBboxBounds(bounds) ? bounds : null);
    });
  }
  const normalizedBounds = settledBounds ? normalizeBboxBounds(settledBounds) : null;
  const bboxString =
    settledBounds &&
    isValidBboxBounds(settledBounds) &&
    normalizedBounds &&
    isValidBboxBounds(normalizedBounds)
      ? formatBbox(normalizedBounds)
      : null;
  const provincesQuery = useQuery({
    ...provinceViewportQueryOptions(bboxString ?? ""),
    enabled: bboxString !== null,
  });
  const provincesState: ViewportProvincesState = {
    status: bboxString === null
      ? "idle"
      : provincesQuery.isPending || provincesQuery.isFetching
        ? "loading"
        : provincesQuery.isError
          ? "error"
          : provincesQuery.data?.features.length
            ? "ready"
            : provincesQuery.data
              ? "empty"
              : "idle",
    data: provincesQuery.data ?? null,
    error: provincesQuery.error
      ? {
          code: provincesQuery.error instanceof ApiClientError
            ? provincesQuery.error.code
            : "NETWORK_ERROR",
          message: provincesQuery.error.message,
          status: provincesQuery.error instanceof ApiClientError
            ? provincesQuery.error.status
            : undefined,
        }
      : null,
    bbox: normalizedBounds,
    bboxString,
  };
  const sitesQuery = useQuery({
    ...siteViewportQueryOptions(bboxString ?? "", provinceFilter),
    enabled: bboxString !== null,
  });
  const viewportState: ViewportSitesState = {
    status: bboxString === null
      ? "idle"
      : sitesQuery.isPending || sitesQuery.isFetching
        ? "loading"
        : sitesQuery.isError
          ? "error"
          : sitesQuery.data?.features.length
            ? "ready"
            : sitesQuery.data
              ? "empty"
              : "idle",
    data: sitesQuery.data ?? null,
    error: sitesQuery.error
      ? {
          code: sitesQuery.error instanceof ApiClientError
            ? sitesQuery.error.code
            : "NETWORK_ERROR",
          message: sitesQuery.error.message,
          status: sitesQuery.error instanceof ApiClientError
            ? sitesQuery.error.status
            : undefined,
        }
      : null,
    bbox: normalizedBounds,
    bboxString,
    province: provinceFilter,
  };

  onViewportStateChangeRef.current = onViewportStateChange;
  onViewportBoundsChangeRef.current = onViewportBoundsChange;
  onProvincesChangeRef.current = onProvincesChange;

  useEffect(() => {
    onViewportStateChangeRef.current?.(viewportState);
  }, [viewportState.status, viewportState.data, sitesQuery.error, viewportState.bboxString, provinceFilter]);

  useEffect(() => {
    if (provincesQuery.data) {
      onProvincesChangeRef.current?.(provincesQuery.data.features);
    }
  }, [provincesQuery.data]);

  useEffect(() => {
    if (retrySignal > 0) void sitesQuery.refetch();
  }, [retrySignal, sitesQuery.refetch]);

  const handleInitialBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    viewportDebouncerRef.current?.cancel();
    setSettledBounds(isValidBboxBounds(bounds) ? bounds : null);
  }, []);

  const handleSettledBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    viewportDebouncerRef.current?.schedule(bounds);
  }, []);

  const handleRetry = useCallback(() => {
    void sitesQuery.refetch();
  }, [sitesQuery.refetch]);

  const handleRetryProvinces = useCallback(() => {
    void provincesQuery.refetch();
  }, [provincesQuery.refetch]);

  const handleResetView = useCallback(() => {
    setResetViewSignal((count) => count + 1);
  }, []);

  const displayedSites =
    visibleSitesOverride !== undefined ? visibleSitesOverride : viewportState.data;
  const siteCount = displayedSites?.features.length ?? 0;
  const provinceCount = provincesState.data?.features.length ?? 0;

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#EEF4F5] text-[#0F292E]">
      <header className="z-20 flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[#CFDDE0] bg-[#FAFCFC] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0B6E4F] text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path
                d="M10 17V9m0 0C10 5.5 7.5 3.5 5 3c0 3 1.5 5.5 5 6zm0 0c0-3 2-5.5 5-6 0 3-1.5 5.5-5 6zm-4 8h8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight text-[#0F292E] sm:text-base">
              Seagrass Monitoring
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleResetView}
            className="rounded-lg border border-[#CFDDE0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#EDF4F5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
          >
            Reset view
          </button>
          {headerActions}
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <section
          aria-label="Map workspace"
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <SeagrassMap
            sites={displayedSites}
            provinces={provincesState.data}
            surveyPoints={surveyPoints}
            selectedSiteCode={selectedSiteCode}
            resetViewSignal={resetViewSignal}
            onInitialBounds={handleInitialBounds}
            onSettledBounds={handleSettledBounds}
            onSelectSite={onSelectSite}
            onMapReady={onMapReady}
            onBasemapError={setBasemapNotice}
          />

          <MapWorkspaceStatus
            siteState={viewportState}
            provinceState={provincesState}
            siteCount={siteCount}
            provinceCount={provinceCount}
            surveyPointCount={surveyPoints?.features.length ?? 0}
            basemapNotice={basemapNotice}
            onRetrySites={handleRetry}
            onResetView={handleResetView}
            onRetryProvinces={handleRetryProvinces}
          />
        </section>

        {sidePanel}
      </main>
    </div>
  );
}
