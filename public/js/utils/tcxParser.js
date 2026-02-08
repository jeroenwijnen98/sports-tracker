/**
 * Parse a TCX XML string into structured data.
 * Returns { laps, allTrackpoints, route, hasGps, hasHeartRate, hasSpeed }
 */
export function parseTcx(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const ns = doc.documentElement.namespaceURI || '';
  const sel = (parent, tag) =>
    ns
      ? parent.getElementsByTagNameNS(ns, tag)
      : parent.getElementsByTagName(tag);

  const laps = [];
  const allTrackpoints = [];
  const route = [];
  let hasGps = false;
  let hasHeartRate = false;
  let hasSpeed = false;

  const lapEls = sel(doc, 'Lap');

  for (let li = 0; li < lapEls.length; li++) {
    const lapEl = lapEls[li];

    const lapDuration = floatVal(sel(lapEl, 'TotalTimeSeconds')[0]);
    const lapDistance = floatVal(sel(lapEl, 'DistanceMeters')[0]);

    // Heart rate from lap averages
    const avgHrEls = sel(lapEl, 'AverageHeartRateBpm');
    const maxHrEls = sel(lapEl, 'MaximumHeartRateBpm');
    const lapAvgHr = avgHrEls.length ? floatVal(sel(avgHrEls[0], 'Value')[0]) : null;
    const lapMaxHr = maxHrEls.length ? floatVal(sel(maxHrEls[0], 'Value')[0]) : null;

    laps.push({
      index: li + 1,
      duration: lapDuration,
      distance: lapDistance,
      avgHR: lapAvgHr,
      maxHR: lapMaxHr,
    });

    const tpEls = sel(lapEl, 'Trackpoint');
    for (let ti = 0; ti < tpEls.length; ti++) {
      const tp = tpEls[ti];

      const timeEl = sel(tp, 'Time')[0];
      const time = timeEl ? timeEl.textContent : null;

      const distEl = sel(tp, 'DistanceMeters')[0];
      const dist = distEl ? parseFloat(distEl.textContent) : null;

      // Position
      const posEls = sel(tp, 'Position');
      let lat = null, lon = null;
      if (posEls.length) {
        lat = floatVal(sel(posEls[0], 'LatitudeDegrees')[0]);
        lon = floatVal(sel(posEls[0], 'LongitudeDegrees')[0]);
        if (lat !== null && lon !== null) {
          hasGps = true;
          route.push([lat, lon]);
        }
      }

      // Heart rate
      const hrBpmEls = sel(tp, 'HeartRateBpm');
      let hr = null;
      if (hrBpmEls.length) {
        hr = floatVal(sel(hrBpmEls[0], 'Value')[0]);
        if (hr !== null) hasHeartRate = true;
      }

      // Speed — in Extensions > TPX > Speed
      let speed = null;
      const extEls = tp.getElementsByTagName('ns3:Speed');
      if (extEls.length) {
        speed = parseFloat(extEls[0].textContent);
        if (!isNaN(speed)) hasSpeed = true;
        else speed = null;
      }
      // Also try without namespace prefix
      if (speed === null) {
        const extEls2 = tp.getElementsByTagName('Speed');
        for (let i = 0; i < extEls2.length; i++) {
          // Only grab Speed inside extensions, skip top-level
          if (extEls2[i].parentElement &&
              (extEls2[i].parentElement.localName === 'TPX' ||
               extEls2[i].parentElement.localName === 'ns3:TPX')) {
            speed = parseFloat(extEls2[i].textContent);
            if (!isNaN(speed)) hasSpeed = true;
            else speed = null;
            break;
          }
        }
      }

      allTrackpoints.push({
        time,
        lat,
        lon,
        heartRate: hr,
        speed,
        distance: dist,
      });
    }
  }

  return { laps, allTrackpoints, route, hasGps, hasHeartRate, hasSpeed };
}

function floatVal(el) {
  if (!el) return null;
  const v = parseFloat(el.textContent);
  return isNaN(v) ? null : v;
}
