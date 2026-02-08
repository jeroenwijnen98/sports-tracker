import { Router } from 'express';
import { tokenCheck } from '../middleware/tokenCheck.js';
import { getExercises, polarFetch, polarFetchRaw } from '../services/polarApi.js';
import { readCache, appendToCache } from '../services/exerciseCache.js';

const router = Router();

router.use(tokenCheck);

router.get('/exercises', async (req, res) => {
  try {
    const exercises = await getExercises(req.accessToken, req.polarUserId);
    // Cache any new exercises server-side
    if (exercises.length > 0) {
      await appendToCache(exercises);
    }
    res.json(exercises);
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
  try {
    const xml = await polarFetchRaw(
      req.accessToken,
      `/exercises/${req.params.id}/tcx`
    );
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('TCX fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch TCX data' });
  }
});

router.get('/exercises/:id/gpx', async (req, res) => {
  try {
    const xml = await polarFetchRaw(
      req.accessToken,
      `/exercises/${req.params.id}/gpx`
    );
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('GPX fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch GPX data' });
  }
});

export default router;
