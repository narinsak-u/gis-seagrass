import type { ProvinceFeatureCollection } from "../provinces/types";
import type { SiteFeatureCollection } from "../sites/types";

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

export const EMPTY_FEATURE_COLLECTION: SiteFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export const EMPTY_PROVINCE_COLLECTION: ProvinceFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
