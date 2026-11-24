import type * as maplibregl from "maplibre-gl";
import {
  buildSiteStatusFillExpression,
  buildSiteStatusStrokeExpression,
} from "@/src/features/sites/status";
import type { ProvinceFeatureCollection } from "../provinces/types";
import type { SiteFeatureCollection } from "../sites/types";
import type { SurveyPointFeatureCollection } from "../surveys/types";
import {
  PROVINCE_CASING_LAYER_ID,
  PROVINCE_FILL_LAYER_ID,
  PROVINCE_LINE_LAYER_ID,
  PROVINCE_SOURCE_ID,
  SITE_FILL_LAYER_ID,
  SITE_OUTLINE_LAYER_ID,
  SITE_SOURCE_ID,
  SURVEY_POINT_FILL_COLOR,
  SURVEY_POINT_HALO_COLOR,
  SURVEY_POINT_HALO_LAYER_ID,
  SURVEY_POINT_LAYER_ID,
  SURVEY_POINT_SOURCE_ID,
  SURVEY_POINT_STROKE_COLOR,
} from "./map-constants";

interface SeagrassMapLayerData {
  sites: SiteFeatureCollection;
  provinces: ProvinceFeatureCollection;
  surveyPoints: SurveyPointFeatureCollection;
  selectedSiteCode: string | null;
}

export function ensureSeagrassMapLayers(
  map: maplibregl.Map,
  { sites, provinces, surveyPoints, selectedSiteCode }: SeagrassMapLayerData,
): void {
  // Add viewport Province boundaries underneath Site polygons so Site fills/clicks remain crisp
  if (!map.getSource(PROVINCE_SOURCE_ID)) {
    map.addSource(PROVINCE_SOURCE_ID, {
      type: "geojson",
      data: provinces as unknown as GeoJSON.FeatureCollection,
    });
  }

  const beforeSites = map.getLayer(SITE_FILL_LAYER_ID) ? SITE_FILL_LAYER_ID : undefined;
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
      beforeSites,
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
      beforeSites,
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
      beforeSites,
    );
  }

  if (!map.getSource(SITE_SOURCE_ID)) {
    map.addSource(SITE_SOURCE_ID, {
      type: "geojson",
      data: sites as unknown as GeoJSON.FeatureCollection,
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
          ["==", ["get", "code"], selectedSiteCode ?? ""],
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
          ["==", ["get", "code"], selectedSiteCode ?? ""],
          "#0F292E",
          buildSiteStatusStrokeExpression(),
        ],
        "line-width": [
          "case",
          ["==", ["get", "code"], selectedSiteCode ?? ""],
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
      data: surveyPoints as unknown as GeoJSON.FeatureCollection,
    });
  }
  if (!map.getLayer(SURVEY_POINT_HALO_LAYER_ID)) {
    map.addLayer({
      id: SURVEY_POINT_HALO_LAYER_ID,
      type: "circle",
      source: SURVEY_POINT_SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 7, 11, 9.5, 15, 11.5],
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
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4.5, 11, 6, 15, 7.5],
        "circle-color": SURVEY_POINT_FILL_COLOR,
        "circle-stroke-color": SURVEY_POINT_STROKE_COLOR,
        "circle-stroke-width": 2,
        "circle-opacity": 0.96,
      },
    });
  }
}
