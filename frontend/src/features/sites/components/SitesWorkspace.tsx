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
import { useAuthStore } from "@/src/features/auth/auth-store";
import { MapWorkspace } from "@/src/features/map/components/MapWorkspace";
import type { ProvinceFeature } from "@/src/features/provinces/types";
import { SurveyHistorySection } from "@/src/features/surveys/components/SurveyHistorySection";
import { useSurveyHistory } from "@/src/features/surveys/hooks/useSurveyHistory";
import { useSiteDetail } from "../hooks/useSiteDetail";
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
} from "../filtering";
import { SiteDetailPanel } from "./SiteDetailPanel";
import { SiteFilters } from "./SiteFilters";
import { SiteTable } from "./SiteTable";
import { SitesWorkspacePanel } from "./SitesWorkspacePanel";
import type { BboxBounds, SiteDetailFeature, SiteFeature } from "../types";
import type { ViewportSitesState } from "../viewport";
import { useSitesWorkspaceStore } from "../state/workspace-store";


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
  const token = useAuthStore((state) => state.token);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const user = useAuthStore((state) => state.user);
  const setSignInOpen = useAuthStore((state) => state.setSignInOpen);
  const handleUnauthorized = useAuthStore((state) => state.handleUnauthorized);

  const [viewportState, setViewportState] = useState<ViewportSitesState>(
    INITIAL_VIEWPORT_STATE,
  );
  const filters = useSitesWorkspaceStore((state) => state.filters);
  const setFilters = useSitesWorkspaceStore((state) => state.setFilters);
  const [knownProvinceCodes, setKnownProvinceCodes] = useState<string[]>([]);
  const [viewportProvinceNames, setViewportProvinceNames] = useState<
    Record<string, string>
  >({});
  const currentPage = useSitesWorkspaceStore((state) => state.currentPage);
  const setCurrentPage = useSitesWorkspaceStore((state) => state.setCurrentPage);
  const selectedSiteCode = useSitesWorkspaceStore((state) => state.selectedSiteCode);
  const selectSite = useSitesWorkspaceStore((state) => state.selectSite);
  const [selectedFeature, setSelectedFeature] = useState<SiteFeature | null>(null);
  const [retrySignal, setRetrySignal] = useState(0);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(true);

  const { state: detailState, retry: retryDetail } = useSiteDetail(selectedSiteCode);
  const {
    state: surveyHistoryState,
    loadMore: loadMoreSurveys,
    retry: retrySurveys,
  } = useSurveyHistory({
    siteCode: selectedSiteCode,
    token,
    sessionEpoch,
    role: user?.role,
    onUnauthorized: (message, requestToken, expectedEpoch) =>
      handleUnauthorized(message, requestToken, expectedEpoch),
  });

  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectedSiteChangeRef = useRef(onSelectedSiteChange);
  const onMapReadyRef = useRef(onMapReady);

  onSelectedSiteChangeRef.current = onSelectedSiteChange;
  onMapReadyRef.current = onMapReady;

  useEffect(() => {
    onSelectedSiteChangeRef.current?.(detailState.data, detailState.selectedCode);
  }, [detailState.data, detailState.selectedCode]);

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

  const handleProvincesChange = useCallback((provinces: ProvinceFeature[]) => {
    if (provinces.length === 0) return;
    setViewportProvinceNames((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const province of provinces) {
        const code = province.properties.code?.trim();
        const nameTh = province.properties.name_th?.trim();
        if (code && nameTh && next[code] !== nameTh) {
          next[code] = nameTh;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const mergedProvinceNames = useMemo(() => {
    const merged = new Map<string, string>(Object.entries(viewportProvinceNames));
    if (provinceNames) {
      if (provinceNames instanceof Map) {
        for (const [code, name] of provinceNames.entries()) {
          merged.set(code, name);
        }
      } else {
        for (const [code, name] of Object.entries(provinceNames)) {
          merged.set(code, name);
        }
      }
    }
    return merged;
  }, [viewportProvinceNames, provinceNames]);

  const provinceOptions = useMemo(
    () =>
      deriveProvinceOptions({
        knownCodes: knownProvinceCodes,
        viewportFeatures: viewportState.data?.features ?? [],
        activeProvince: filters.province,
        provinceNames: mergedProvinceNames,
      }),
    [knownProvinceCodes, viewportState.data, filters.province, mergedProvinceNames],
  );

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;
    onMapReadyRef.current?.(map);
  }, []);

  const handleFiltersChange = useCallback((next: SiteFilterCriteria) => {
    setFilters(next);
  }, [setFilters]);

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_SITE_FILTERS);
  }, [setFilters]);

  const handleSelectRow = useCallback((feature: SiteFeature) => {
    setSelectedFeature(feature);
    selectSite(feature.properties.code);
    setIsMobilePanelOpen(true);

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
  }, [selectSite]);

  const handleSelectPolygon = useCallback(
    (feature: SiteFeature) => {
      setSelectedFeature(feature);
      selectSite(feature.properties.code);
      setIsMobilePanelOpen(true);

      const targetPage = findPageForSiteCode(
        filteredFeaturesRef.current,
        feature.properties.code,
        pageSize,
      );
      if (targetPage !== null) {
        setCurrentPage(targetPage);
      }
    },
    [pageSize, selectSite, setCurrentPage],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedFeature(null);
    selectSite(null);
  }, [selectSite]);

  const handleRetryDetail = useCallback(() => {
    void retryDetail();
  }, [retryDetail]);

  const handleRetryViewport = useCallback(() => {
    setRetrySignal((count) => count + 1);
  }, []);

  const handleLoadMoreSurveys = useCallback(() => {
    void loadMoreSurveys();
  }, [loadMoreSurveys]);

  const handleRetrySurveys = useCallback(() => {
    void retrySurveys();
  }, [retrySurveys]);

  const handleRequestSignIn = useCallback(() => {
    setSignInOpen(true);
  }, [setSignInOpen]);

  const defaultRenderSurveyHistory = useCallback(
    (site: SiteDetailFeature) => (
      <SurveyHistorySection
        site={site}
        historyState={surveyHistoryState}
        onRequestSignIn={handleRequestSignIn}
        onLoadMore={handleLoadMoreSurveys}
        onRetry={handleRetrySurveys}
      />
    ),
    [
      surveyHistoryState,
      handleRequestSignIn,
      handleLoadMoreSurveys,
      handleRetrySurveys,
    ],
  );

  const totalInView = viewportState.data?.features.length ?? 0;
  const matchedCount = filteredFeatures.length;
  const filtersActive = hasActiveSiteFilters(filters);

  const sidePanel = (onResetView: () => void) => (
    <SitesWorkspacePanel
      isMobilePanelOpen={isMobilePanelOpen}
      hasSelectedSite={Boolean(selectedSiteCode)}
      matchedCount={matchedCount}
      onToggleMobilePanel={() => setIsMobilePanelOpen((open) => !open)}
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
        provinceNames={mergedProvinceNames}
        onSelectRow={handleSelectRow}
        onPageChange={setCurrentPage}
        onClearFilters={handleClearFilters}
        onRetry={handleRetryViewport}
        onResetView={onResetView}
      />

      <SiteDetailPanel
        selectedFeature={selectedFeature}
        detailState={detailState}
        provinceNames={mergedProvinceNames}
        onClose={handleCloseDetail}
        onRetry={handleRetryDetail}
        renderSurveyHistory={renderSurveyHistory ?? defaultRenderSurveyHistory}
      />
    </SitesWorkspacePanel>
  );

  return (
    <MapWorkspace
      headerActions={headerActions}
      sidePanel={sidePanel}
      provinceFilter={filters.province || undefined}
      visibleSitesOverride={filteredCollection}
      selectedSiteCode={selectedSiteCode}
      surveyPoints={surveyHistoryState.points}
      onSelectSite={handleSelectPolygon}
      onMapReady={handleMapReady}
      onViewportStateChange={handleViewportStateChange}
      onViewportBoundsChange={onViewportBoundsChange}
      onProvincesChange={handleProvincesChange}
      retrySignal={retrySignal}
    />
  );
}
