import { Router } from 'express';
import express from 'express';
import { tokenCheck } from '../middleware/tokenCheck.ts';
import { polarRequest, XML_ACCEPT } from '../services/polarApi.ts';
import { syncFromPolar } from '../services/polarSync.ts';
import { readCache, appendToCache, removeFromCache } from '../services/exerciseCache.ts';
import { readXmlCache, writeXmlCache } from '../services/xmlCache.ts';
import { withHrSensor } from '../services/hrSensor.ts';
import { polarJsonToTcx, polarJsonToExercise, extractTcxMetadata } from '../services/importConverters.ts';

const router = Router();

router.use(tokenCheck);

router.get('/exercises', async (req, res) => {
  try {
    await syncFromPolar({ accessToken: req.accessToken, userId: req.polarUserId });

    // Return all cached exercises (combines both sources)
    const all = await readCache();
    res.json(await withHrSensor(all));
  } catch (err) {
    console.error('Exercises fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch exercises from Polar' });
  }
});

router.get('/exercises/cached', async (req, res) => {
  try {
    const cached = await readCache();
    res.json(await withHrSensor(cached));
  } catch (err) {
    console.error('Cache read error:', err.message);
    res.json([]);
  }
});

router.delete('/exercises/:id', async (req, res) => {
  try {
    const removed = await removeFromCache(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Activiteit niet gevonden' });
    console.log(`[Cache] Deleted exercise ${req.params.id}`);
    res.status(204).end();
  } catch (err) {
    console.error('Exercise delete error:', err.message);
    res.status(500).json({ error: 'Verwijderen mislukt' });
  }
});

router.get('/exercises/:id/:type', async (req, res, next) => {
  const { id, type } = req.params;
  if (!XML_ACCEPT[type]) return next();

  // Serve from server-side cache (populated during sync transaction)
  const cached = await readXmlCache(type, id);
  if (cached) {
    return res.type('application/xml').send(cached);
  }

  // Fallback: try Training Data API (works outside transactions)
  try {
    const polarRes = await polarRequest(req.accessToken, `/exercises/${id}/${type}`, { accept: XML_ACCEPT[type] });
    const xml = await polarRes.text();
    await writeXmlCache(type, id, xml);
    console.log(`[Polar] Fetched & cached ${type.toUpperCase()} for ${id} via Training Data API`);
    return res.type('application/xml').send(xml);
  } catch {
    // Training Data API doesn't have it either
  }

  res.status(404).json({ error: `${type.toUpperCase()} data niet beschikbaar.` });
});

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

    // Convert to TCX for detail data (chart, laps, map)
    const tcxXml = polarJsonToTcx(session);
    const exercise = polarJsonToExercise(session);

    // Check for duplicate
    const cached = await readCache();
    if (cached.some((e) => e.id === exercise.id)) {
      return res.status(409).json({ error: 'Deze activiteit is al geïmporteerd', exercise: { id: exercise.id } });
    }

    await writeXmlCache('tcx', exercise.id, tcxXml);
    await appendToCache([exercise]);

    console.log(`[Import] Imported JSON exercise ${exercise.id} (${exercise['start-time']}, ${exercise['detailed-sport-info']})`);
    res.json(exercise);
  } catch (err) {
    console.error('JSON import error:', err.message);
    res.status(500).json({ error: 'Import mislukt' });
  }
});

export default router;
