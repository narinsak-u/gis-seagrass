"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildSiteStatusFillExpression,
  buildSiteStatusStrokeExpression,
} from "@/src/features/sites/status";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
} from "@/src/features/sites/types";

export const OPENFREEMAP_LIBERTY_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

export const DEFAULT_MAP_CENTER: [number, number] = [98.85, 8.05];
export const DEFAULT_MAP_ZOOM = 7.4;

export const SITE_SOURCE_ID = "seagrass-sites";
export const SITE_FILL_LAYER_ID = "seagrass-sites-fill";
export const SITE_OUTLINE_LAYER_ID = "seagrass-sites-outline";

const EMPTY_FEATURE_COLLECTION: SiteFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface SeagrassMapProps {
  sites: SiteFeatureCollection | null;
  selectedSiteCode?: string | null;
  resetViewSignal?: number;
  onInitialBounds: (bounds: BboxBounds) => void;
  onSettledBounds: (bounds: BboxBounds) => void;
  onSelectSite?: (feature: SiteFeature) => void;
  onMapReady?: (map: maplibregl.Map) => void;
  onBasemapError?: (message: string) => void;
}

function readMapBounds(map: maplibregl.Map): BboxBounds {
  const bounds = map.getBounds();
  return {
    minLon: bounds.getWest(),
    minLat: bounds.getSouth(),
    maxLon: bounds.getEast(),
    maxLat: bounds.getNorth(),
  };
}

export function SeagrassMap({
  sites,
  selectedSiteCode = null,
  resetViewSignal = 0,
  onInitialBounds,
  onSettledBounds,
  onSelectSite,
  onMapReady,
  onBasemapError,
}: SeagrassMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersReadyRef = useRef(false);
  const latestSitesRef = useRef<SiteFeatureCollection>(EMPTY_FEATURE_COLLECTION);
  const latestSelectedCodeRef = useRef<string | null>(selectedSiteCode);

  const onInitialBoundsRef = useRef(onInitialBounds);
  const onSettledBoundsRef = useRef(onSettledBounds);
  const onSelectSiteRef = useRef(onSelectSite);
  const onMapReadyRef = useRef(onMapReady);
  const onBasemapErrorRef = useRef(onBasemapError);

  onInitialBoundsRef.current = onInitialBounds;
  onSettledBoundsRef.current = onSettledBounds;
  onSelectSiteRef.current = onSelectSite;
  onMapReadyRef.current = onMapReady;
  onBasemapErrorRef.current = onBasemapError;
  latestSitesRef.current = sites ?? EMPTY_FEATURE_COLLECTION;
  latestSelectedCodeRef.current = selectedSiteCode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    maplibregl.setWorkerUrl(
      new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString(),
    );

    const map = new maplibregl.Map({
      container,
      style: OPENFREEMAP_LIBERTY_STYLE_URL,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      minZoom: 4,
      maxZoom: 18,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: true }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: false,
      }),
      "bottom-right",
    );

    const ensureSiteLayers = () => {
      if (!map.getSource(SITE_SOURCE_ID)) {
        map.addSource(SITE_SOURCE_ID, {
          type: "geojson",
          data: latestSitesRef.current as unknown as GeoJSON.FeatureCollection,
        });
      }

      if (!map.getLayer(SITE_FILL_LAYER_ID)) {
        map.addLayer({
          id: SITE_FILL_LAYER_ID,
          type: "fill",
          source: SITE_SOURCE_ID,
          paint: {
            "fill-color": buildSiteStatusFillExpression(),
            "fill-opacity": [
              "case",
              ["==", ["get", "code"], latestSelectedCodeRef.current ?? ""],
              0.82,
              0.62,
            ],
          },
        });
      }

      if (!map.getLayer(SITE_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: SITE_OUTLINE_LAYER_ID,
          type: "line",
          source: SITE_SOURCE_ID,
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "code"], latestSelectedCodeRef.current ?? ""],
              "#0F292E",
              buildSiteStatusStrokeExpression(),
            ],
            "line-width": [
              "case",
              ["==", ["get", "code"], latestSelectedCodeRef.current ?? ""],
              3.2,
              1.8,
            ],
          },
        });
      }

      layersReadyRef.current = true;
    };

    const handleLoad = () => {
      ensureSiteLayers();
      onMapReadyRef.current?.(map);
      onInitialBoundsRef.current(readMapBounds(map));
    };

    const handleMoveEnd = () => {
      onSettledBoundsRef.current(readMapBounds(map));
    };

    const handleSiteClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || !onSelectSiteRef.current) return;
      const code = feature.properties?.code;
      if (typeof code !== "string") return;
      const match = latestSitesRef.current.features.find(
        (candidate) => candidate.properties.code === code,
      );
      if (match) {
        onSelectSiteRef.current(match);
      }
    };

    const handleMouseEnter = () => {
      if (onSelectSiteRef.current) {
        map.getCanvas().style.cursor = "pointer";
      }
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const handleMapError = (event: maplibregl.ErrorEvent) => {
      const message = event.error?.message;
      if (message && !layersReadyRef.current) {
        onBasemapErrorRef.current?.(
          "Basemap tiles are temporarily unavailable. Site boundaries can still be loaded.",
        );
      }
    };

    map.on("load", handleLoad);
    map.on("moveend", handleMoveEnd);
    map.on("click", SITE_FILL_LAYER_ID, handleSiteClick);
    map.on("mouseenter", SITE_FILL_LAYER_ID, handleMouseEnter);
    map.on("mouseleave", SITE_FILL_LAYER_ID, handleMouseLeave);
    map.on("error", handleMapError);

    return () => {
      layersReadyRef.current = false;
      map.off("load", handleLoad);
      map.off("moveend", handleMoveEnd);
      map.off("click", SITE_FILL_LAYER_ID, handleSiteClick);
      map.off("mouseenter", SITE_FILL_LAYER_ID, handleMouseEnter);
      map.off("mouseleave", SITE_FILL_LAYER_ID, handleMouseLeave);
      map.off("error", handleMapError);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current) return;
    const source = map.getSource(SITE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData((sites ?? EMPTY_FEATURE_COLLECTION) as unknown as GeoJSON.FeatureCollection);
    }
  }, [sites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current) return;
    const selected = selectedSiteCode ?? "";
    if (map.getLayer(SITE_FILL_LAYER_ID)) {
      map.setPaintProperty(SITE_FILL_LAYER_ID, "fill-opacity", [
        "case",
        ["==", ["get", "code"], selected],
        0.82,
        0.62,
      ]);
    }
    if (map.getLayer(SITE_OUTLINE_LAYER_ID)) {
      map.setPaintProperty(SITE_OUTLINE_LAYER_ID, "line-color", [
        "case",
        ["==", ["get", "code"], selected],
        "#0F292E",
        buildSiteStatusStrokeExpression(),
      ]);
      map.setPaintProperty(SITE_OUTLINE_LAYER_ID, "line-width", [
        "case",
        ["==", ["get", "code"], selected],
        3.2,
        1.8,
      ]);
    }
  }, [selectedSiteCode]);

  useEffect(() => {
    if (resetViewSignal === 0) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      duration: 500,
    });
  }, [resetViewSignal]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Seagrass sites interactive map"
      className="h-full w-full"
    />
  );
}
