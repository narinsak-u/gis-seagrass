export function validCoordinates(type: 'Polygon' | 'MultiPolygon', coordinates: unknown): boolean {
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) return false;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return false;
      for (const position of ring) {
        if (!Array.isArray(position) || position.length !== 2) return false;
        const [longitude, latitude] = position;
        if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
          || typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
      }
      const first = ring[0] as number[];
      const last = ring[ring.length - 1] as number[];
      if (first[0] !== last[0] || first[1] !== last[1]) return false;
    }
  }
  return true;
}
