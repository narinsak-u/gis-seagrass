"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildSiteStatusFillExpression,
  buildSiteStatusStrokeExpression,
} from "@/src/features/sites/status";
import type { ProvinceFeatureCollection } from "@/src/features/provinces/types";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
} from "@/src/features/sites/types";
import {
  EMPTY_SURVEY_POINT_COLLECTION,
  type SurveyPointFeatureCollection,
} from "@/src/features/surveys/types";

export const OPENFREEMAP_LIBERTY_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

export const DEFAULT_MAP_CENTER: [number, number] = [98.85, 8.05];
export const DEFAULT_MAP_ZOOM = 7.4;

export const PROVINCE_SOURCE_ID = "seagrass-provinces";
export const PROVINCE_FILL_LAYER_ID = "seagrass-provinces-fill";
export const PROVINCE_CASING_LAYER_ID = "seagrass-provinces-casing";
export const PROVINCE_LINE_LAYER_ID = "seagrass-provinces-line";

export const SITE_SOURCE_ID = "seagrass-sites";
export const SITE_FILL_LAYER_ID = "seagrass-sites-fill";
export const SITE_OUTLINE_LAYER_ID = "seagrass-sites-outline";

export const SURVEY_POINT_SOURCE_ID = "seagrass-survey-points";
export const SURVEY_POINT_HALO_LAYER_ID = "seagrass-survey-points-halo";
export const SURVEY_POINT_LAYER_ID = "seagrass-survey-points-circle";

export const SURVEY_POINT_FILL_COLOR = "#7E22CE";
export const SURVEY_POINT_STROKE_COLOR = "#FFFFFF";
export const SURVEY_POINT_HALO_COLOR = "#3B0764";

const EMPTY_FEATURE_COLLECTION: SiteFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_PROVINCE_COLLECTION: ProvinceFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface SeagrassMapProps {
  sites: SiteFeatureCollection | null;
  provinces?: ProvinceFeatureCollection | null;
  surveyPoints?: SurveyPointFeatureCollection | null;
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

function createSurveyPopupNode(props: Record<string, unknown>, coords: [number, number]): HTMLDivElement {
  const root = document.createElement("div");
  root.style.fontSize = "12px";
  root.style.lineHeight = "1.4";
  root.style.color = "#0F292E";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  const surveyedOn = typeof props.surveyed_on === "string" ? props.surveyed_on : "Survey";
  const cover =
    typeof props.cover_percent === "number"
      ? `${props.cover_percent}% cover`
      : typeof props.cover_percent === "string"
        ? `${props.cover_percent}% cover`
        : "";
  title.textContent = cover ? `${surveyedOn} · ${cover}` : surveyedOn;
  root.appendChild(title);

  const meta = document.createElement("div");
  meta.style.color = "#436066";
  meta.style.fontSize = "11px";
  meta.textContent = `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`;
  root.appendChild(meta);

  if (typeof props.species === "string" && props.species.trim().length > 0) {
    const speciesEl = document.createElement("div");
    speciesEl.style.marginTop = "2px";
    speciesEl.style.fontSize = "11px";
    speciesEl.textContent = `Species: ${props.species}`;
    root.appendChild(speciesEl);
  }

  return root;
}

export function SeagrassMap({
  sites,
  provinces = null,
  surveyPoints = null,
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
  const surveyPopupRef = useRef<maplibregl.Popup | null>(null);
  const layersReadyRef = useRef(false);
  const latestSitesRef = useRef<SiteFeatureCollection>(EMPTY_FEATURE_COLLECTION);
  const latestProvincesRef = useRef<ProvinceFeatureCollection>(EMPTY_PROVINCE_COLLECTION);
  const latestSurveyPointsRef = useRef<SurveyPointFeatureCollection>(EMPTY_SURVEY_POINT_COLLECTION);
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
  latestProvincesRef.current = provinces ?? EMPTY_PROVINCE_COLLECTION;
  latestSurveyPointsRef.current = surveyPoints ?? EMPTY_SURVEY_POINT_COLLECTION;
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

    const ensureMapLayers = () => {
      // Add viewport Province boundaries underneath Site polygons so Site fills/clicks remain crisp
      if (!map.getSource(PROVINCE_SOURCE_ID)) {
        map.addSource(PROVINCE_SOURCE_ID, {
          type: "geojson",
          data: latestProvincesRef.current as unknown as GeoJSON.FeatureCollection,
        });
      }

      const siteBeforeId = map.getLayer(SITE_FILL_LAYER_ID) ? SITE_FILL_LAYER_ID : undefined;

      if (!map.getLayer(PROVINCE_FILL_LAYER_ID)) {
        map.addLayer(
          {
            id: PROVINCE_FILL_LAYER_ID,
            type: "fill",
            source: PROVINCE_SOURCE_ID,
            paint: {
              "fill-color": "#1E4E79",
              "fill-opacity": 0.04,
            },
          },
          siteBeforeId,
        );
      }

      if (!map.getLayer(PROVINCE_CASING_LAYER_ID)) {
        map.addLayer(
          {
            id: PROVINCE_CASING_LAYER_ID,
            type: "line",
            source: PROVINCE_SOURCE_ID,
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#FFFFFF",
              "line-opacity": 0.85,
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.8, 9, 4.2, 13, 5.2],
            },
          },
          siteBeforeId,
        );
      }

      if (!map.getLayer(PROVINCE_LINE_LAYER_ID)) {
        map.addLayer(
          {
            id: PROVINCE_LINE_LAYER_ID,
            type: "line",
            source: PROVINCE_SOURCE_ID,
            layout: {
              "line-join": "round",
              "line-cap": "butt",
            },
            paint: {
              "line-color": "#2B4C8C",
              "line-opacity": 0.9,
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 9, 2.4, 13, 3.0],
              "line-dasharray": [4, 2],
            },
          },
          siteBeforeId,
        );
      }

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

      // Render authorized selected-Site Survey points ABOVE Site polygons
      if (!map.getSource(SURVEY_POINT_SOURCE_ID)) {
        map.addSource(SURVEY_POINT_SOURCE_ID, {
          type: "geojson",
          data: latestSurveyPointsRef.current as unknown as GeoJSON.FeatureCollection,
        });
      }

      if (!map.getLayer(SURVEY_POINT_HALO_LAYER_ID)) {
        map.addLayer({
          id: SURVEY_POINT_HALO_LAYER_ID,
          type: "circle",
          source: SURVEY_POINT_SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              7,
              11,
              9.5,
              15,
              11.5,
            ],
            "circle-color": SURVEY_POINT_HALO_COLOR,
            "circle-opacity": 0.26,
          },
        });
      }

      if (!map.getLayer(SURVEY_POINT_LAYER_ID)) {
        map.addLayer({
          id: SURVEY_POINT_LAYER_ID,
          type: "circle",
          source: SURVEY_POINT_SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              4.5,
              11,
              6,
              15,
              7.5,
            ],
            "circle-color": SURVEY_POINT_FILL_COLOR,
            "circle-stroke-color": SURVEY_POINT_STROKE_COLOR,
            "circle-stroke-width": 2,
            "circle-opacity": 0.96,
          },
        });
      }

      layersReadyRef.current = true;
    };

    const handleLoad = () => {
      ensureMapLayers();
      onMapReadyRef.current?.(map);
      onInitialBoundsRef.current(readMapBounds(map));
    };

    const handleMoveEnd = () => {
      onSettledBoundsRef.current(readMapBounds(map));
    };

    const handleSurveyPointClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const coords = feature.geometry.coordinates as [number, number];
      if (!Array.isArray(coords) || coords.length < 2) return;

      surveyPopupRef.current?.remove();
      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 10,
      })
        .setLngLat([coords[0], coords[1]])
        .setDOMContent(
          createSurveyPopupNode(
            (feature.properties ?? {}) as Record<string, unknown>,
            [coords[0], coords[1]],
          ),
        )
        .addTo(map);
      surveyPopupRef.current = popup;
    };

    const handleSiteClick = (event: maplibregl.MapLayerMouseEvent) => {
      if (map.getLayer(SURVEY_POINT_LAYER_ID)) {
        const pointHits = map.queryRenderedFeatures(event.point, {
          layers: [SURVEY_POINT_LAYER_ID],
        });
        if (pointHits.length > 0) return;
      }
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

    const handleSurveyMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
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
    map.on("click", SURVEY_POINT_LAYER_ID, handleSurveyPointClick);
    map.on("mouseenter", SURVEY_POINT_LAYER_ID, handleSurveyMouseEnter);
    map.on("mouseleave", SURVEY_POINT_LAYER_ID, handleMouseLeave);
    map.on("click", SITE_FILL_LAYER_ID, handleSiteClick);
    map.on("mouseenter", SITE_FILL_LAYER_ID, handleMouseEnter);
    map.on("mouseleave", SITE_FILL_LAYER_ID, handleMouseLeave);
    map.on("error", handleMapError);

    return () => {
      layersReadyRef.current = false;
      surveyPopupRef.current?.remove();
      surveyPopupRef.current = null;
      map.off("load", handleLoad);
      map.off("moveend", handleMoveEnd);
      map.off("click", SURVEY_POINT_LAYER_ID, handleSurveyPointClick);
      map.off("mouseenter", SURVEY_POINT_LAYER_ID, handleSurveyMouseEnter);
      map.off("mouseleave", SURVEY_POINT_LAYER_ID, handleMouseLeave);
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
    const source = map.getSource(PROVINCE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(
        (provinces ?? EMPTY_PROVINCE_COLLECTION) as unknown as GeoJSON.FeatureCollection,
      );
    }
  }, [provinces]);

  useEffect(() => {
    const nextPoints = surveyPoints ?? EMPTY_SURVEY_POINT_COLLECTION;
    if (nextPoints.features.length === 0) {
      surveyPopupRef.current?.remove();
      surveyPopupRef.current = null;
    }
    const map = mapRef.current;
    if (!map || !layersReadyRef.current) return;
    const source = map.getSource(SURVEY_POINT_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(nextPoints as unknown as GeoJSON.FeatureCollection);
    }
  }, [surveyPoints]);

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
