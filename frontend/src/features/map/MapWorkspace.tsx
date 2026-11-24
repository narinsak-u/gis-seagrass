"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type * as maplibregl from "maplibre-gl";
import { fetchActiveSitesGeoJson } from "@/src/lib/api";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
} from "@/src/features/sites/types";
import {
  createViewportSitesController,
  type ViewportSitesController,
  type ViewportSitesState,
} from "@/src/features/sites/viewport";
import { SeagrassMap } from "./SeagrassMap";
import { StatusLegend } from "./StatusLegend";

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
}

const INITIAL_VIEWPORT_STATE: ViewportSitesState = {
  status: "idle",
  data: null,
  error: null,
  bbox: null,
  bboxString: null,
  province: undefined,
};

export function MapWorkspace({
  headerActions,
  sidePanel,
  provinceFilter,
  visibleSitesOverride,
  selectedSiteCode = null,
  onSelectSite,
  onMapReady,
  onViewportStateChange,
  onViewportBoundsChange,
  retrySignal = 0,
}: MapWorkspaceProps) {
  const [viewportState, setViewportState] = useState<ViewportSitesState>(
    INITIAL_VIEWPORT_STATE,
  );
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const [resetViewSignal, setResetViewSignal] = useState(0);

  const controllerRef = useRef<ViewportSitesController | null>(null);
  const provinceFilterRef = useRef(provinceFilter);
  const onViewportStateChangeRef = useRef(onViewportStateChange);
  const onViewportBoundsChangeRef = useRef(onViewportBoundsChange);

  provinceFilterRef.current = provinceFilter;
  onViewportStateChangeRef.current = onViewportStateChange;
  onViewportBoundsChangeRef.current = onViewportBoundsChange;

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

    return () => {
      controller.dispose();
      controllerRef.current = null;
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
  }, []);

  const handleSettledBounds = useCallback((bounds: BboxBounds) => {
    onViewportBoundsChangeRef.current?.(bounds);
    controllerRef.current?.onViewportSettled(bounds, provinceFilterRef.current);
  }, []);

  const handleRetry = useCallback(() => {
    controllerRef.current?.retry();
  }, []);

  const handleResetView = useCallback(() => {
    setResetViewSignal((count) => count + 1);
  }, []);

  const displayedSites =
    visibleSitesOverride !== undefined ? visibleSitesOverride : viewportState.data;
  const siteCount = displayedSites?.features.length ?? 0;

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
            selectedSiteCode={selectedSiteCode}
            resetViewSignal={resetViewSignal}
            onInitialBounds={handleInitialBounds}
            onSettledBounds={handleSettledBounds}
            onSelectSite={onSelectSite}
            onMapReady={onMapReady}
            onBasemapError={setBasemapNotice}
          />

          {/* Top-left floating status & recovery overlays (leaves space for top-right map controls) */}
          <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-col gap-2 sm:max-w-sm">
            {viewportState.status === "loading" && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/95 px-3 py-2 text-xs font-medium text-[#0F292E] shadow-sm backdrop-blur-sm"
              >
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#0D6E6E]/25 border-t-[#0D6E6E]"
                />
                <span>Loading active sites in view…</span>
              </div>
            )}

            {viewportState.status === "ready" && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/95 px-3 py-1.5 text-xs font-medium text-[#0F292E] shadow-sm backdrop-blur-sm tabular-nums"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-[#0B6E4F]"
                />
                <span>
                  {siteCount} {siteCount === 1 ? "active site" : "active sites"} in view
                </span>
              </div>
            )}

            {viewportState.status === "empty" && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-auto rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/96 px-3.5 py-2.5 text-xs text-[#0F292E] shadow-md backdrop-blur-sm"
              >
                <p className="font-semibold text-[#0F292E]">
                  No active sites in this view
                </p>
                <p className="mt-0.5 text-[#436066]">
                  Pan or zoom toward the coast to browse monitored seagrass beds.
                </p>
                <button
                  type="button"
                  onClick={handleResetView}
                  className="mt-2 rounded-lg bg-[#0D6E6E] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#095252] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
                >
                  Return to coastal view
                </button>
              </div>
            )}

            {viewportState.status === "error" && viewportState.error && (
              <div
                role="alert"
                className="pointer-events-auto rounded-xl border border-[#E5B8AF] bg-[#FFF8F6]/98 px-3.5 py-2.5 text-xs text-[#5E1E11] shadow-md backdrop-blur-sm"
              >
                <p className="font-semibold">Unable to load sites for this area</p>
                <p className="mt-0.5 text-[#7A2D1D]">{viewportState.error.message}</p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-2 rounded-lg bg-[#8F2F1B] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
                >
                  Retry request
                </button>
              </div>
            )}

            {basemapNotice && (
              <div
                role="status"
                className="pointer-events-auto rounded-xl border border-[#E4D3A3] bg-[#FFFBF0]/95 px-3 py-2 text-xs text-[#6B4E08] shadow-sm"
              >
                {basemapNotice}
              </div>
            )}
          </div>

          {/* Bottom-left status legend — elevated slightly on narrow mobile screens so MapLibre attribution at bottom-right stays unobstructed */}
          <div className="pointer-events-none absolute bottom-10 left-3 z-10 sm:bottom-3 sm:left-3">
            <StatusLegend />
          </div>
        </section>

        {sidePanel}
      </main>
    </div>
  );
}
