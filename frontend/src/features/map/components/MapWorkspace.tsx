"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type * as maplibregl from "maplibre-gl";
import { fetchActiveSitesGeoJson } from "@/src/lib/api";
import { fetchProvincesGeoJson } from "@/src/features/provinces/api";
import {
  createViewportProvincesController,
  type ViewportProvincesController,
  type ViewportProvincesState,
} from "@/src/features/provinces/provinces-viewport";
import type { ProvinceFeature } from "@/src/features/provinces/types";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
} from "@/src/features/sites/types";
import type { SurveyPointFeatureCollection } from "@/src/features/surveys/types";
import {
  createViewportSitesController,
  type ViewportSitesController,
  type ViewportSitesState,
} from "@/src/features/sites/viewport";
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

const INITIAL_VIEWPORT_STATE: ViewportSitesState = {
  status: "idle",
  data: null,
  error: null,
  bbox: null,
  bboxString: null,
  province: undefined,
};

const INITIAL_PROVINCES_STATE: ViewportProvincesState = {
  status: "idle",
  data: null,
  error: null,
  bbox: null,
  bboxString: null,
};

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
  const [viewportState, setViewportState] = useState<ViewportSitesState>(
    INITIAL_VIEWPORT_STATE,
  );
  const [provincesState, setProvincesState] = useState<ViewportProvincesState>(
    INITIAL_PROVINCES_STATE,
  );
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const [resetViewSignal, setResetViewSignal] = useState(0);

  const controllerRef = useRef<ViewportSitesController | null>(null);
  const provincesControllerRef = useRef<ViewportProvincesController | null>(null);
  const provinceFilterRef = useRef(provinceFilter);
  const onViewportStateChangeRef = useRef(onViewportStateChange);
  const onViewportBoundsChangeRef = useRef(onViewportBoundsChange);
  const onProvincesChangeRef = useRef(onProvincesChange);

  provinceFilterRef.current = provinceFilter;
  onViewportStateChangeRef.current = onViewportStateChange;
  onViewportBoundsChangeRef.current = onViewportBoundsChange;
  onProvincesChangeRef.current = onProvincesChange;

  useEffect(() => {
    const controller = createViewportSitesController({
      debounceMs: 250,
      fetchSites: ({ bbox, province, signal }) =>
        fetchActiveSitesGeoJson({ bbox, province, signal }),
      onStateChange: (next) => {
        setViewportState(next);
        onViewportStateChangeRef.current?.(next);
      },
    });
    controllerRef.current = controller;

    const provincesController = createViewportProvincesController({
      debounceMs: 250,
      fetchProvinces: ({ bbox, signal }) =>
        fetchProvincesGeoJson({ bbox, signal }),
      onStateChange: (next) => {
        setProvincesState(next);
        if (next.status === "ready" || next.status === "empty") {
          onProvincesChangeRef.current?.(next.data?.features ?? []);
        }
      },
    });
    provincesControllerRef.current = provincesController;

    return () => {
      controller.dispose();
      controllerRef.current = null;
      provincesController.dispose();
      provincesControllerRef.current = null;
    };
  }, []);

  // Re-query current viewport when provinceFilter prop changes (Ticket 02 hook)
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const current = controller.getState();
    if (current.bbox && current.province !== provinceFilter) {
      controller.loadInitial(current.bbox, provinceFilter);
    }
  }, [provinceFilter]);

  useEffect(() => {
    if (retrySignal === 0) return;
    controllerRef.current?.retry();
  }, [retrySignal]);

  const handleInitialBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    controllerRef.current?.loadInitial(bounds, provinceFilterRef.current);
    provincesControllerRef.current?.loadInitial(bounds);
  }, []);

  const handleSettledBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    controllerRef.current?.onViewportSettled(bounds, provinceFilterRef.current);
    provincesControllerRef.current?.onViewportSettled(bounds);
  }, []);

  const handleRetry = useCallback(() => {
    controllerRef.current?.retry();
  }, []);

  const handleRetryProvinces = useCallback(() => {
    provincesControllerRef.current?.retry();
  }, []);

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
