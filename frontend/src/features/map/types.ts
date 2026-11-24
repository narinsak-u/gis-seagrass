import type * as maplibregl from "maplibre-gl";
import type { ProvinceFeatureCollection } from "../provinces/types";
import type {
  BboxBounds,
  SiteFeature,
  SiteFeatureCollection,
} from "../sites/types";
import type { SurveyPointFeatureCollection } from "../surveys/types";

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
