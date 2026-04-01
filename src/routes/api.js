import { Router } from 'express';
import express from 'express';
import { createHash } from 'node:crypto';
import { tokenCheck } from '../middleware/tokenCheck.js';
import { getExercises, polarFetch, polarFetchRaw } from '../services/polarApi.js';
import { readCache, appendToCache } from '../services/exerciseCache.js';
import { readXmlCache, writeXmlCache } from '../services/xmlCache.js';

const router = Router();

router.use(tokenCheck);

router.get('/exercises', async (req, res) => {
  try {
    // Pull Notifications: transaction-based, one-time consumption
    const exercises = await getExercises(req.accessToken, req.polarUserId);
    if (exercises.length > 0) {
      await appendToCache(exercises);
    }

    // Training Data API: fetch any exercises not yet in our cache
    try {
      const trainingExercises = await polarFetch(req.accessToken, '/exercises');
      if (trainingExercises.length > 0) {
        const added = await appendToCache(trainingExercises);
        if (added > 0) {
          console.log(`[Polar] Added ${added} exercises from Training Data API`);
        }
      }
    } catch (err) {
      console.log('[Polar] Training Data API unavailable:', err.message);
    }

    // Return all cached exercises (combines both sources)
    const all = await readCache();
    res.json(all.length > 0 ? all : exercises);
  } catch (err) {
    console.error('Exercises fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch exercises from Polar' });
  }
});

router.get('/exercises/cached', async (req, res) => {
  try {
    const cached = await readCache();
    res.json(cached);
  } catch (err) {
    console.error('Cache read error:', err.message);
    res.json([]);
  }
});

router.get('/exercises/:id', async (req, res) => {
  try {
    const data = await polarFetch(
      req.accessToken,
      `/exercises/${req.params.id}`
    );
    res.json(data);
  } catch (err) {
    console.error('Exercise detail error:', err.message);
    res.status(502).json({ error: 'Failed to fetch exercise detail' });
  }
});

router.get('/exercises/:id/tcx', async (req, res) => {
  const id = req.params.id;

  // Serve from server-side cache (populated during sync transaction)
  const cached = await readXmlCache('tcx', id);
  if (cached) {
    return res.type('application/xml').send(cached);
  }

  // Fallback: try Training Data API (works outside transactions)
  try {
    const xml = await polarFetchRaw(req.accessToken, `/exercises/${id}/tcx`);
    await writeXmlCache('tcx', id, xml);
    console.log(`[Polar] Fetched & cached TCX for ${id} via Training Data API`);
    return res.type('application/xml').send(xml);
  } catch {
    // Training Data API doesn't have it either
  }

  res.status(404).json({ error: 'TCX data niet beschikbaar.' });
});

router.get('/exercises/:id/gpx', async (req, res) => {
  const id = req.params.id;

  const cached = await readXmlCache('gpx', id);
  if (cached) {
    return res.type('application/xml').send(cached);
  }

  // Fallback: try Training Data API
  try {
    const xml = await polarFetchRaw(req.accessToken, `/exercises/${id}/gpx`, 'application/gpx+xml');
    await writeXmlCache('gpx', id, xml);
    console.log(`[Polar] Fetched & cached GPX for ${id} via Training Data API`);
    return res.type('application/xml').send(xml);
  } catch {
    // Training Data API doesn't have it either
  }

  res.status(404).json({ error: 'GPX data niet beschikbaar.' });
});

// Import helpers
const TCX_SPORT_MAP = {
  Running: 'RUNNING',
  Biking: 'CYCLING',
  Other: 'OTHER',
};

const POLAR_SPORT_TO_TCX = {
  RUNNING: 'Running',
  TRAIL_RUNNING: 'Running',
  TREADMILL_RUNNING: 'Running',
  CYCLING: 'Biking',
  ROAD_BIKING: 'Biking',
  MOUNTAIN_BIKING: 'Biking',
};

const POLAR_SPORT_TO_DETAILED = {
  RUNNING: 'RUNNING',
  TRAIL_RUNNING: 'TRAIL_RUNNING',
  TREADMILL_RUNNING: 'TREADMILL_RUNNING',
};

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert a Polar data export training-session JSON into TCX XML.
 */
function polarJsonToTcx(session) {
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
      if (ex.kiloCalories && lapSource.length > 0) {
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

function parsePTSeconds(pt) {
  const m = pt.match(/PT(\d+(?:\.\d+)?)S/);
  return m ? parseFloat(m[1]) : 0;
}

function extractTcxMetadata(xml) {
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

  // Deterministic ID from start-time
  const hash = createHash('sha256').update(startTime || xml.slice(0, 500)).digest('hex');
  const id = `import-${hash.slice(0, 16)}`;

  return {
    id,
    'start-time': startTime,
    'detailed-sport-info': sport,
    duration,
    distance: Math.round(totalDistance),
    calories: totalCalories || undefined,
    'heart-rate': avgHr || maxHr ? { average: avgHr, maximum: maxHr } : undefined,
    source: 'tcx-import',
  };
}

router.post('/exercises/import', express.text({ type: 'text/xml', limit: '5mb' }), async (req, res) => {
  try {
    const xml = req.body;
    if (!xml || typeof xml !== 'string') {
      return res.status(400).json({ error: 'Geen TCX data ontvangen' });
    }

    const exercise = extractTcxMetadata(xml);

    // Check if already imported
    const cached = await readCache();
    if (cached.some((e) => e.id === exercise.id)) {
      return res.status(409).json({ error: 'Deze activiteit is al geïmporteerd', exercise });
    }

    // Save TCX to xml cache and exercise to exercise cache
    await writeXmlCache('tcx', exercise.id, xml);
    await appendToCache([exercise]);

    console.log(`[Import] Imported TCX exercise ${exercise.id} (${exercise['start-time']})`);
    res.json(exercise);
  } catch (err) {
    console.error('TCX import error:', err.message);
    res.status(500).json({ error: 'Import mislukt' });
  }
});

// Polar JSON data export import
router.post('/exercises/import-json', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const session = req.body;
    if (!session?.exercises?.length) {
      return res.status(400).json({ error: 'Geen training sessie gevonden in JSON' });
    }

    const ex = session.exercises[0];
    const sport = ex.sport || 'OTHER';
    const detailedSport = POLAR_SPORT_TO_DETAILED[sport] || sport;

    // Convert to TCX for detail data (chart, laps, map)
    const tcxXml = polarJsonToTcx(session);

    // Build exercise object
    const startTime = ex.startTime;
    const hash = createHash('sha256').update(startTime).digest('hex');
    const id = `import-${hash.slice(0, 16)}`;

    // Check for duplicate
    const cached = await readCache();
    if (cached.some((e) => e.id === id)) {
      return res.status(409).json({ error: 'Deze activiteit is al geïmporteerd', exercise: { id } });
    }

    const exercise = {
      id,
      'start-time': startTime,
      'detailed-sport-info': detailedSport,
      duration: ex.duration,
      distance: Math.round(ex.distance || 0),
      calories: ex.kiloCalories || undefined,
      'heart-rate': ex.heartRate ? { average: ex.heartRate.avg, maximum: ex.heartRate.max } : undefined,
      device: session.deviceId || 'Polar Beat',
      source: 'json-import',
    };

    await writeXmlCache('tcx', id, tcxXml);
    await appendToCache([exercise]);

    console.log(`[Import] Imported JSON exercise ${id} (${startTime}, ${sport})`);
    res.json(exercise);
  } catch (err) {
    console.error('JSON import error:', err.message);
    res.status(500).json({ error: 'Import mislukt' });
  }
});

export default router;
