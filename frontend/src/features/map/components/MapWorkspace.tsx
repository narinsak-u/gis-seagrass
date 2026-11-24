"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  sidePanel?: ReactNode | ((onResetView: () => void) => ReactNode);
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
  const [viewportPending, setViewportPending] = useState(false);
  const queryClient = useQueryClient();

  const onViewportStateChangeRef = useRef(onViewportStateChange);
  const onViewportBoundsChangeRef = useRef(onViewportBoundsChange);
  const onProvincesChangeRef = useRef(onProvincesChange);
  const handledRetrySignalRef = useRef(retrySignal);
  const viewportDebouncerRef = useRef<ReturnType<typeof createViewportDebouncer> | null>(null);
  if (!viewportDebouncerRef.current) {
    viewportDebouncerRef.current = createViewportDebouncer((bounds) => {
      setSettledBounds(bounds);
      setViewportPending(false);
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
    enabled: bboxString !== null && !viewportPending,
  });
  const provincesState: ViewportProvincesState = {
    status: getViewportStatus(settledBounds, bboxString, viewportPending, provincesQuery, provincesQuery.data),
    data: bboxString && !viewportPending ? provincesQuery.data ?? null : null,
    error: getViewportError(provincesQuery.error),
    bbox: normalizedBounds,
    bboxString,
  };
  const sitesQuery = useQuery({
    ...siteViewportQueryOptions(bboxString ?? "", provinceFilter),
    enabled: bboxString !== null && !viewportPending,
  });
  const viewportState: ViewportSitesState = {
    status: getViewportStatus(settledBounds, bboxString, viewportPending, sitesQuery, sitesQuery.data),
    data: bboxString && !viewportPending ? sitesQuery.data ?? null : null,
    error: getViewportError(sitesQuery.error),
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
    if (!viewportPending && bboxString && provincesQuery.data) {
      onProvincesChangeRef.current?.(provincesQuery.data.features);
    }
  }, [provincesQuery.data, bboxString, viewportPending]);

  useEffect(() => {
    if (retrySignal <= handledRetrySignalRef.current) return;
    handledRetrySignalRef.current = retrySignal;
    if (bboxString && !viewportPending) void sitesQuery.refetch();
  }, [retrySignal, sitesQuery.refetch, bboxString, viewportPending]);

  const handleInitialBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    viewportDebouncerRef.current?.cancel();
    setViewportPending(false);
    setSettledBounds(bounds);
  }, []);

  const handleSettledBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    const nextBounds = isValidBboxBounds(bounds) ? normalizeBboxBounds(bounds) : null;
    if (bboxString && nextBounds && isValidBboxBounds(nextBounds) && formatBbox(nextBounds) === bboxString) {
      return;
    }
    void queryClient.cancelQueries({ queryKey: ["sites", "viewport"] });
    void queryClient.cancelQueries({ queryKey: ["provinces", "viewport"] });
    setViewportPending(true);
    onViewportStateChangeRef.current?.({
      status: "loading",
      data: null,
      error: null,
      bbox: null,
      bboxString: null,
      province: provinceFilter,
    });
    setSettledBounds(null);
    viewportDebouncerRef.current?.schedule(bounds);
  }, [bboxString, queryClient, provinceFilter]);

  const handleRetry = useCallback(() => {
    if (bboxString) void sitesQuery.refetch();
  }, [bboxString, sitesQuery.refetch]);

  const handleRetryProvinces = useCallback(() => {
    if (bboxString) void provincesQuery.refetch();
  }, [bboxString, provincesQuery.refetch]);

  const handleResetView = useCallback(() => {
    setResetViewSignal((count) => count + 1);
  }, []);

  const displayedSites =
    viewportPending || !bboxString
      ? null
      : visibleSitesOverride !== undefined ? visibleSitesOverride : viewportState.data;
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

        {typeof sidePanel === "function" ? sidePanel(handleResetView) : sidePanel}
      </main>
    </div>
  );
}

function getViewportStatus(
  bounds: BboxBounds | null,
  bboxString: string | null,
  pending: boolean,
  query: { isPending: boolean; isFetching: boolean; isError: boolean },
  data: { features: readonly unknown[] } | undefined,
): ViewportSitesState["status"] {
  if (pending) return "loading";
  if (!bounds) return "idle";
  if (!bboxString) return "invalid";
  if (query.isPending || query.isFetching) return "loading";
  if (query.isError) return "error";
  if (data) return data.features.length ? "ready" : "empty";
  return "idle";
}

function getViewportError(error: unknown): ViewportSitesState["error"] {
  if (!error) return null;
  return {
    code: error instanceof ApiClientError ? error.code : "NETWORK_ERROR",
    message: error instanceof Error ? error.message : "Request failed",
    status: error instanceof ApiClientError ? error.status : undefined,
  };
}
