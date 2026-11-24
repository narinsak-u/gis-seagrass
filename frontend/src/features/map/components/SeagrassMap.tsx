"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useSeagrassMap } from "../hooks/useSeagrassMap";
import type { SeagrassMapProps } from "../types";

export function SeagrassMap(props: SeagrassMapProps) {
  const containerRef = useSeagrassMap(props);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Seagrass sites interactive map"
      className="h-full w-full"
    />
  );
}
