import { describe, expect, it } from "vitest";
import type * as maplibregl from "maplibre-gl";
import {
  EMPTY_FEATURE_COLLECTION,
  EMPTY_PROVINCE_COLLECTION,
  PROVINCE_CASING_LAYER_ID,
  PROVINCE_FILL_LAYER_ID,
  PROVINCE_LINE_LAYER_ID,
  PROVINCE_SOURCE_ID,
  SITE_FILL_LAYER_ID,
  SITE_OUTLINE_LAYER_ID,
  SITE_SOURCE_ID,
  SURVEY_POINT_HALO_LAYER_ID,
  SURVEY_POINT_LAYER_ID,
  SURVEY_POINT_SOURCE_ID,
} from "../map-constants";
import { EMPTY_SURVEY_POINT_COLLECTION } from "@/src/features/surveys/types";
import { ensureSeagrassMapLayers } from "../map-layers";

function createMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  const order: string[] = [];
  return {
    sources,
    layers,
    order,
    map: {
      getSource: (id: string) => sources.get(id),
      getLayer: (id: string) => layers.get(id),
      addSource: (id: string, source: unknown) => sources.set(id, source),
      addLayer: (layer: { id: string }, beforeId?: string) => {
        layers.set(layer.id, layer);
        const index = beforeId ? order.indexOf(beforeId) : -1;
        if (index === -1) order.push(layer.id);
        else order.splice(index, 0, layer.id);
      },
    } as unknown as maplibregl.Map,
  };
}

describe("Seagrass map layers", () => {
  it("keeps Provinces below Sites and Survey points above Sites without duplicates", () => {
    const { map, sources, layers, order } = createMap();
    const options = {
      sites: EMPTY_FEATURE_COLLECTION,
      provinces: EMPTY_PROVINCE_COLLECTION,
      surveyPoints: EMPTY_SURVEY_POINT_COLLECTION,
      selectedSiteCode: null,
    };

    ensureSeagrassMapLayers(map, options);
    ensureSeagrassMapLayers(map, options);

    expect([...sources.keys()]).toEqual([
      PROVINCE_SOURCE_ID,
      SITE_SOURCE_ID,
      SURVEY_POINT_SOURCE_ID,
    ]);
    expect(order).toEqual([
      PROVINCE_FILL_LAYER_ID,
      PROVINCE_CASING_LAYER_ID,
      PROVINCE_LINE_LAYER_ID,
      SITE_FILL_LAYER_ID,
      SITE_OUTLINE_LAYER_ID,
      SURVEY_POINT_HALO_LAYER_ID,
      SURVEY_POINT_LAYER_ID,
    ]);
    expect(new Set(order).size).toBe(order.length);
    expect(layers.size).toBe(order.length);
  });
});
