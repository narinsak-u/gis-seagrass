export interface ProvinceProperties {
  code: string;
  name_th: string;
}

export interface ProvinceGeometry {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export interface ProvinceFeature {
  type: "Feature";
  geometry: ProvinceGeometry;
  properties: ProvinceProperties;
}

export interface ProvinceFeatureCollection {
  type: "FeatureCollection";
  features: ProvinceFeature[];
}
