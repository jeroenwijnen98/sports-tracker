/**
 * Pure converters for imported exercises: a Polar data export training-session
 * JSON becomes TCX (its detail data) and an exercise, and an uploaded TCX
 * becomes an exercise. No file or network access, so the import routes only
 * call these and handle storage themselves.
 */

import { createHash } from 'node:crypto';

const TCX_SPORT_MAP = {
  Running: 'RUNNING',
  Biking: 'CYCLING',
  Other: 'OTHER',
};

const POLAR_SPORT_TO_TCX = {
  RUNNING: 'Running',
  TRAIL_RUNNING: 'Running',
  TREADMILL_RUNNING: 'Running',
  ULTRARUNNING_RUNNING: 'Running',
  CYCLING: 'Biking',
  ROAD_BIKING: 'Biking',
  MOUNTAIN_BIKING: 'Biking',
};

const POLAR_SPORT_TO_DETAILED = {
  RUNNING: 'RUNNING',
  TRAIL_RUNNING: 'TRAIL_RUNNING',
  TREADMILL_RUNNING: 'TREADMILL_RUNNING',
  ULTRARUNNING_RUNNING: 'ULTRARUNNING_RUNNING',
};

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert a Polar data export training-session JSON into TCX XML.
 */
export function polarJsonToTcx(session) {
  const ex = session.exercises?.[0];
  if (!ex) throw new Error('No exercise found in training session');

  const tcxSport = POLAR_SPORT_TO_TCX[ex.sport] || 'Other';
  const startTime = ex.startTime;
  const startDate = new Date(startTime);

  // Build merged trackpoint timeline from all sample types
  // HR/speed/distance samples share timestamps; route samples have different timestamps
  const hrSamples = ex.samples?.heartRate || [];
  const speedSamples = ex.samples?.speed || [];
  const distSamples = ex.samples?.distance || [];
  const routeSamples = ex.samples?.recordedRoute || [];

  // Index all sample types by dateTime
  const hrByTime = new Map();
  for (const s of hrSamples) hrByTime.set(s.dateTime, s.value);
  const speedByTime = new Map();
  for (const s of speedSamples) speedByTime.set(s.dateTime, s.value);
  const distByTime = new Map();
  for (const s of distSamples) distByTime.set(s.dateTime, s.value);
  const routeByTime = new Map();
  for (const r of routeSamples) routeByTime.set(r.dateTime, r);

  // Collect all unique timestamps and sort chronologically
  const allTimes = new Set([
    ...hrSamples.map((s) => s.dateTime),
    ...routeSamples.map((s) => s.dateTime),
  ]);
  const sortedTimes = [...allTimes].sort();

  // Helper: build trackpoint XML for a time range
  function buildTrackpointXml(times) {
    let tpXml = '';
    for (const timeStr of times) {
      const hr = hrByTime.get(timeStr);
      const spd = speedByTime.get(timeStr);
      const dist = distByTime.get(timeStr);
      const routePt = routeByTime.get(timeStr);

      tpXml += '            <Trackpoint>\n';
      tpXml += `              <Time>${escapeXml(timeStr)}</Time>\n`;
      if (routePt) {
        tpXml += '              <Position>\n';
        tpXml += `                <LatitudeDegrees>${routePt.latitude}</LatitudeDegrees>\n`;
        tpXml += `                <LongitudeDegrees>${routePt.longitude}</LongitudeDegrees>\n`;
        tpXml += '              </Position>\n';
        if (routePt.altitude != null) {
          tpXml += `              <AltitudeMeters>${routePt.altitude}</AltitudeMeters>\n`;
        }
      }
      if (dist != null) {
        tpXml += `              <DistanceMeters>${dist}</DistanceMeters>\n`;
      }
      if (hr != null) {
        tpXml += `              <HeartRateBpm><Value>${Math.round(hr)}</Value></HeartRateBpm>\n`;
      }
      if (spd != null) {
        tpXml += '              <Extensions><TPX><Speed>' + spd + '</Speed></TPX></Extensions>\n';
      }
      tpXml += '            </Trackpoint>\n';
    }
    return tpXml;
  }

  // Build laps — prefer manual laps over autoLaps (manual laps contain intervals)
  const manualLaps = ex.laps || [];
  const autoLaps = ex.autoLaps || [];
  const lapSource = manualLaps.length > 0 ? manualLaps : autoLaps;
  let lapXmls = '';

  if (lapSource.length > 0) {
    let timeIdx = 0;

    for (const lap of lapSource) {
      const lapDurSec = parsePTSeconds(lap.duration);
      const lapDist = lap.distance || 0;
      const lapStartTime = new Date(startDate.getTime() + (lap.splitTime ? parsePTSeconds(lap.splitTime) - lapDurSec : 0) * 1000);
      const lapEndMs = lapStartTime.getTime() + lapDurSec * 1000;

      // Collect timestamps that fall within this lap
      const lapTimes = [];
      while (timeIdx < sortedTimes.length) {
        const t = new Date(sortedTimes[timeIdx]).getTime();
        if (t > lapEndMs) break;
        lapTimes.push(sortedTimes[timeIdx]);
        timeIdx++;
      }

      lapXmls += `        <Lap StartTime="${escapeXml(lapStartTime.toISOString())}">\n`;
      lapXmls += `          <TotalTimeSeconds>${lapDurSec}</TotalTimeSeconds>\n`;
      lapXmls += `          <DistanceMeters>${lapDist}</DistanceMeters>\n`;
      if (lap.heartRate?.avg) {
        lapXmls += `          <AverageHeartRateBpm><Value>${Math.round(lap.heartRate.avg)}</Value></AverageHeartRateBpm>\n`;
      }
      if (lap.heartRate?.max) {
        lapXmls += `          <MaximumHeartRateBpm><Value>${Math.round(lap.heartRate.max)}</Value></MaximumHeartRateBpm>\n`;
      }
      if (ex.kiloCalories) {
        lapXmls += `          <Calories>${Math.round(ex.kiloCalories / lapSource.length)}</Calories>\n`;
      }
      lapXmls += '          <Track>\n' + buildTrackpointXml(lapTimes) + '          </Track>\n';
      lapXmls += '        </Lap>\n';
    }
  } else {
    // No laps — single lap with all trackpoints
    const durSec = parsePTSeconds(ex.duration);

    lapXmls += `        <Lap StartTime="${escapeXml(startTime)}">\n`;
    lapXmls += `          <TotalTimeSeconds>${durSec}</TotalTimeSeconds>\n`;
    lapXmls += `          <DistanceMeters>${ex.distance || 0}</DistanceMeters>\n`;
    if (ex.heartRate?.avg) {
      lapXmls += `          <AverageHeartRateBpm><Value>${Math.round(ex.heartRate.avg)}</Value></AverageHeartRateBpm>\n`;
    }
    if (ex.heartRate?.max) {
      lapXmls += `          <MaximumHeartRateBpm><Value>${Math.round(ex.heartRate.max)}</Value></MaximumHeartRateBpm>\n`;
    }
    if (ex.kiloCalories) {
      lapXmls += `          <Calories>${Math.round(ex.kiloCalories)}</Calories>\n`;
    }
    lapXmls += '          <Track>\n' + buildTrackpointXml(sortedTimes) + '          </Track>\n';
    lapXmls += '        </Lap>\n';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="${tcxSport}">
      <Id>${escapeXml(startTime)}</Id>
${lapXmls}    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

export function parsePTSeconds(pt) {
  const m = pt.match(/PT(\d+(?:\.\d+)?)S/);
  return m ? parseFloat(m[1]) : 0;
}

export function extractTcxMetadata(xml) {
  const startTime = xml.match(/<Id>([^<]+)<\/Id>/)?.[1] || null;

  const sportAttr = xml.match(/<Activity Sport="([^"]+)"/)?.[1] || 'Running';
  const sport = TCX_SPORT_MAP[sportAttr] || 'RUNNING';

  // Extract per-lap blocks, then sum their totals
  const laps = [...xml.matchAll(/<Lap[\s\S]*?<\/Lap>/g)];
  let totalSeconds = 0;
  let totalDistance = 0;
  let totalCalories = 0;

  for (const [lapXml] of laps) {
    const time = lapXml.match(/<TotalTimeSeconds>([^<]+)<\/TotalTimeSeconds>/);
    const dist = lapXml.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/);
    const cal = lapXml.match(/<Calories>([^<]+)<\/Calories>/);
    if (time) totalSeconds += parseFloat(time[1]);
    if (dist) totalDistance += parseFloat(dist[1]);
    if (cal) totalCalories += parseInt(cal[1], 10);
  }

  // Duration as ISO 8601
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  const duration = `PT${hours}H${minutes}M${seconds}S`;

  // Heart rate
  const avgHrs = [...xml.matchAll(/<AverageHeartRateBpm>\s*<Value>(\d+)<\/Value>/g)];
  const maxHrs = [...xml.matchAll(/<MaximumHeartRateBpm>\s*<Value>(\d+)<\/Value>/g)];
  const avgHr = avgHrs.length > 0
    ? Math.round(avgHrs.reduce((s, m) => s + parseInt(m[1], 10), 0) / avgHrs.length)
    : undefined;
  const maxHr = maxHrs.length > 0
    ? Math.max(...maxHrs.map((m) => parseInt(m[1], 10)))
    : undefined;

  return {
    id: importId(startTime || xml.slice(0, 500)),
    'start-time': startTime,
    'detailed-sport-info': sport,
    duration,
    distance: Math.round(totalDistance),
    calories: totalCalories || undefined,
    'heart-rate': avgHr || maxHr ? { average: avgHr, maximum: maxHr } : undefined,
    source: 'tcx-import',
  };
}

/**
 * Deterministic id for an imported exercise, from its start time, so importing
 * the same run twice (as JSON or as TCX) is caught as a duplicate.
 */
function importId(key) {
  const hash = createHash('sha256').update(key).digest('hex');
  return `import-${hash.slice(0, 16)}`;
}

/**
 * Build the exercise for a Polar data export training-session JSON.
 */
export function polarJsonToExercise(session) {
  const ex = session.exercises[0];
  const sport = ex.sport || 'OTHER';
  const startTime = ex.startTime;

  return {
    id: importId(startTime),
    'start-time': startTime,
    'detailed-sport-info': POLAR_SPORT_TO_DETAILED[sport] || sport,
    duration: ex.duration,
    distance: Math.round(ex.distance || 0),
    calories: ex.kiloCalories || undefined,
    'heart-rate': ex.heartRate ? { average: ex.heartRate.avg, maximum: ex.heartRate.max } : undefined,
    device: session.deviceId || 'Polar Beat',
    source: 'json-import',
  };
}
