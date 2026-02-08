/**
 * Parse a GPX XML string for route data (map-only fallback).
 * Returns { route, hasGps }
 */
export function parseGpx(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const route = [];
  const trkpts = doc.getElementsByTagName('trkpt');

  for (let i = 0; i < trkpts.length; i++) {
    const lat = parseFloat(trkpts[i].getAttribute('lat'));
    const lon = parseFloat(trkpts[i].getAttribute('lon'));
    if (!isNaN(lat) && !isNaN(lon)) {
      route.push([lat, lon]);
    }
  }

  return { route, hasGps: route.length > 0 };
}
