import { queryOptions } from "@tanstack/react-query";
import type { BboxBounds } from "@/src/features/sites/types";
import type {
  ViewportErrorInfo,
  ViewportLoadStatus,
} from "@/src/features/sites/viewport";
import { fetchProvincesGeoJson } from "./api";
import type { ProvinceFeatureCollection } from "./types";

export interface ViewportProvincesState {
  status: ViewportLoadStatus;
  data: ProvinceFeatureCollection | null;
  error: ViewportErrorInfo | null;
  bbox: BboxBounds | null;
  bboxString: string | null;
}

export function provinceViewportQueryOptions(bbox: string) {
  return queryOptions({
    queryKey: ["provinces", "viewport", bbox],
    queryFn: ({ signal }) => fetchProvincesGeoJson({ bbox, signal }),
  });
}
