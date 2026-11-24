"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type * as maplibregl from "maplibre-gl";
import { fetchSiteDetail } from "@/src/lib/api";
import { MapWorkspace } from "@/src/features/map/MapWorkspace";
import {
  createSiteDetailController,
  INITIAL_SITE_DETAIL_STATE,
  type SiteDetailController,
  type SiteDetailState,
} from "./detail";
import {
  computeSiteBounds,
  deriveProvinceOptions,
  EMPTY_SITE_FILTERS,
  filterSiteCollection,
  findPageForSiteCode,
  hasActiveSiteFilters,
  mergeKnownProvinceCodes,
  type ProvinceNameLookup,
  type SiteFilterCriteria,
} from "./filtering";
import { SiteDetailPanel } from "./SiteDetailPanel";
import { SiteFilters } from "./SiteFilters";
import { SiteTable } from "./SiteTable";
import type { BboxBounds, SiteDetailFeature, SiteFeature } from "./types";
import type { ViewportSitesState } from "./viewport";

export interface SitesWorkspaceProps {
  /** Extension slot for Ticket 04 authentication controls. */
  headerActions?: ReactNode;
  /** Optional Province code -> name_th lookup supplied by Ticket 03. */
  provinceNames?: ProvinceNameLookup;
  /** Callback whenever map viewport bounds settle (Ticket 03). */
  onViewportBoundsChange?: (bounds: BboxBounds) => void;
  /** Callback when the MapLibre map instance is ready (Tickets 03, 05). */
  onMapReady?: (map: maplibregl.Map) => void;
  /** Callback when selected Site or its detail changes (Ticket 05). */
  onSelectedSiteChange?: (
    site: SiteDetailFeature | null,
    selectedCode: string | null,
  ) => void;
  /** Extension slot for Ticket 05 protected Survey history inside SiteDetailPanel. */
  renderSurveyHistory?: (site: SiteDetailFeature) => ReactNode;
  /** Number of rows per client-side table page (defaults to 8). */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 8;

const INITIAL_VIEWPORT_STATE: ViewportSitesState = {
  status: "idle",
  data: null,
  error: null,
  bbox: null,
  bboxString: null,
  province: undefined,
};

export function SitesWorkspace({
  headerActions,
  provinceNames,
  onViewportBoundsChange,
  onMapReady,
  onSelectedSiteChange,
  renderSurveyHistory,
  pageSize = DEFAULT_PAGE_SIZE,
}: SitesWorkspaceProps) {
  const [viewportState, setViewportState] = useState<ViewportSitesState>(
    INITIAL_VIEWPORT_STATE,
  );
  const [filters, setFilters] = useState<SiteFilterCriteria>(EMPTY_SITE_FILTERS);
  const [knownProvinceCodes, setKnownProvinceCodes] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFeature, setSelectedFeature] = useState<SiteFeature | null>(null);
  const [detailState, setDetailState] = useState<SiteDetailState>(
    INITIAL_SITE_DETAIL_STATE,
  );
  const [retrySignal, setRetrySignal] = useState(0);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(true);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const detailControllerRef = useRef<SiteDetailController | null>(null);
  const onSelectedSiteChangeRef = useRef(onSelectedSiteChange);
  const onMapReadyRef = useRef(onMapReady);

  onSelectedSiteChangeRef.current = onSelectedSiteChange;
  onMapReadyRef.current = onMapReady;

  useEffect(() => {
    const controller = createSiteDetailController({
      fetchSiteDetail: ({ code, signal }) => fetchSiteDetail({ code, signal }),
      onStateChange: (next) => {
        setDetailState(next);
        onSelectedSiteChangeRef.current?.(next.data, next.selectedCode);
      },
    });
    detailControllerRef.current = controller;

    return () => {
      controller.dispose();
      detailControllerRef.current = null;
    };
  }, []);

  const handleViewportStateChange = useCallback((next: ViewportSitesState) => {
    setViewportState(next);
    if (next.status === "ready" || next.status === "empty") {
      const features = next.data?.features ?? [];
      const isProvinceFiltered = Boolean(next.province && next.province.trim().length > 0);
      setKnownProvinceCodes((prev) =>
        mergeKnownProvinceCodes(prev, features, isProvinceFiltered),
      );
    }
  }, []);

  const filteredCollection = useMemo(
    () => filterSiteCollection(viewportState.data, filters),
    [viewportState.data, filters],
  );

  const filteredFeatures = useMemo(
    () => filteredCollection?.features ?? [],
    [filteredCollection],
  );

  const filteredFeaturesRef = useRef<readonly SiteFeature[]>(filteredFeatures);
  filteredFeaturesRef.current = filteredFeatures;

  const provinceOptions = useMemo(
    () =>
      deriveProvinceOptions({
        knownCodes: knownProvinceCodes,
        viewportFeatures: viewportState.data?.features ?? [],
        activeProvince: filters.province,
        provinceNames,
      }),
    [knownProvinceCodes, viewportState.data, filters.province, provinceNames],
  );

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;
    onMapReadyRef.current?.(map);
  }, []);

  const handleFiltersChange = useCallback((next: SiteFilterCriteria) => {
    setFilters(next);
    setCurrentPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_SITE_FILTERS);
    setCurrentPage(1);
  }, []);

  const handleSelectRow = useCallback((feature: SiteFeature) => {
    setSelectedFeature(feature);
    setIsMobilePanelOpen(true);
    detailControllerRef.current?.select(feature.properties.code);

    const map = mapRef.current;
    const bounds = computeSiteBounds(feature.geometry);
    if (map && bounds) {
      map.fitBounds(
        [
          [bounds.minLon, bounds.minLat],
          [bounds.maxLon, bounds.maxLat],
        ],
        {
          padding: { top: 64, bottom: 72, left: 48, right: 48 },
          maxZoom: 14,
          duration: 550,
        },
      );
    }
  }, []);

  const handleSelectPolygon = useCallback(
    (feature: SiteFeature) => {
      setSelectedFeature(feature);
      setIsMobilePanelOpen(true);
      detailControllerRef.current?.select(feature.properties.code);

      const targetPage = findPageForSiteCode(
        filteredFeaturesRef.current,
        feature.properties.code,
        pageSize,
      );
      if (targetPage !== null) {
        setCurrentPage(targetPage);
      }
    },
    [pageSize],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedFeature(null);
    detailControllerRef.current?.clear();
  }, []);

  const handleRetryDetail = useCallback(() => {
    detailControllerRef.current?.retry();
  }, []);

  const handleRetryViewport = useCallback(() => {
    setRetrySignal((count) => count + 1);
  }, []);

  const totalInView = viewportState.data?.features.length ?? 0;
  const matchedCount = filteredFeatures.length;
  const filtersActive = hasActiveSiteFilters(filters);
  const selectedSiteCode = detailState.selectedCode;

  const sidePanel = (
    <aside
      aria-label="Synchronized site list and details"
      className={`z-10 flex w-full max-w-full flex-col overflow-hidden border-t border-[#CFDDE0] bg-[#FAFCFC] lg:h-full lg:w-[420px] lg:shrink-0 lg:border-t-0 lg:border-l xl:w-[450px] ${
        isMobilePanelOpen
          ? selectedSiteCode
            ? "h-[58%]"
            : "h-[48%]"
          : "h-auto"
      }`}
    >
      {/* Mobile collapsible header bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#CFDDE0] bg-[#F4F8F9] px-3 py-2 lg:hidden">
        <span className="text-xs font-semibold text-[#0F292E] tabular-nums">
          Sites in view ({matchedCount})
        </span>
        <button
          type="button"
          aria-expanded={isMobilePanelOpen}
          onClick={() => setIsMobilePanelOpen((open) => !open)}
          className="rounded-md border border-[#CFDDE0] bg-white px-2.5 py-1 text-xs font-medium text-[#0D6E6E] transition-colors hover:bg-[#E7F1F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
        >
          {isMobilePanelOpen ? "Hide list" : "Show list"}
        </button>
      </div>

      <div
        className={`${
          isMobilePanelOpen ? "flex" : "hidden lg:flex"
        } min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden`}
      >
        <SiteFilters
          filters={filters}
          provinceOptions={provinceOptions}
          matchedCount={matchedCount}
          totalInView={totalInView}
          isLoading={viewportState.status === "loading"}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
        />

        <SiteTable
          features={filteredFeatures}
          page={currentPage}
          pageSize={pageSize}
          selectedSiteCode={selectedSiteCode}
          viewportStatus={viewportState.status}
          viewportError={viewportState.error}
          hasActiveFilters={filtersActive}
          provinceNames={provinceNames}
          onSelectRow={handleSelectRow}
          onPageChange={setCurrentPage}
          onClearFilters={handleClearFilters}
          onRetry={handleRetryViewport}
        />

        <SiteDetailPanel
          selectedFeature={selectedFeature}
          detailState={detailState}
          provinceNames={provinceNames}
          onClose={handleCloseDetail}
          onRetry={handleRetryDetail}
          renderSurveyHistory={renderSurveyHistory}
        />
      </div>
    </aside>
  );

  return (
    <MapWorkspace
      headerActions={headerActions}
      sidePanel={sidePanel}
      provinceFilter={filters.province || undefined}
      visibleSitesOverride={filteredCollection}
      selectedSiteCode={selectedSiteCode}
      onSelectSite={handleSelectPolygon}
      onMapReady={handleMapReady}
      onViewportStateChange={handleViewportStateChange}
      onViewportBoundsChange={onViewportBoundsChange}
      retrySignal={retrySignal}
    />
  );
}
