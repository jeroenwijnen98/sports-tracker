import { Router } from 'express';
import type { Response } from 'express';
import express from 'express';
import { tokenCheck } from '../middleware/tokenCheck.ts';
import { withToken } from '../services/polarApi.ts';
import { syncFromPolar } from '../services/polarSync.ts';
import * as archive from '../services/exerciseArchive.ts';
import { readExerciseXml } from '../services/exerciseXml.ts';
import { importExercise, diskImportStore } from '../services/importExercise.ts';
import type { ImportSource } from '../services/importExercise.ts';
import type { ExportSession } from '../services/importConverters.ts';

const router = Router();

router.use(tokenCheck);

router.get('/exercises', async (req, res) => {
  try {
    // tokenCheck has set both, or the request never got here
    await syncFromPolar({ request: withToken(req.accessToken!), userId: req.polarUserId! });

    // Return all stored exercises (combines both sources)
    res.json(await archive.list());
  } catch (err) {
    console.error('Exercises fetch error:', (err as Error).message);
    // An unreadable cache is this server's fault, not Polar's
    if (err instanceof archive.CorruptCacheError) {
      res.status(500).json({ error: 'Opgeslagen activiteiten onleesbaar' });
      return;
    }
    res.status(502).json({ error: 'Failed to fetch exercises from Polar' });
  }
});

router.delete('/exercises/:id', async (req, res) => {
  try {
    const removed = await archive.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Activiteit niet gevonden' });
    console.log(`[Cache] Deleted exercise ${req.params.id}`);
    res.status(204).end();
  } catch (err) {
    console.error('Exercise delete error:', (err as Error).message);
    res.status(500).json({ error: 'Verwijderen mislukt' });
  }
});

router.get('/exercises/:id/:type', async (req, res, next) => {
  const { id, type } = req.params;
  const answer = await readExerciseXml(withToken(req.accessToken!), type, id);
  if (answer.status === 'not-xml') return next();
  if (answer.status === 'found') return res.type('application/xml').send(answer.xml);
  res.status(404).json({ error: `${type.toUpperCase()} data niet beschikbaar.` });
});

/**
 * Hand an import to `importExercise()` and map its result to HTTP: 200 with
 * the new exercise, 409 with the stored one, 500 on a thrown error.
 */
async function sendImport(res: Response, source: ImportSource): Promise<void> {
  try {
    const { status, exercise } = await importExercise(source, diskImportStore);
    if (status === 'duplicate') {
      res.status(409).json({ error: 'Deze activiteit is al geïmporteerd', exercise });
      return;
    }
    console.log(`[Import] Imported ${source.kind.toUpperCase()} exercise ${exercise.id} (${exercise['start-time']}, ${exercise['detailed-sport-info']})`);
    res.json(exercise);
  } catch (err) {
    console.error(`${source.kind.toUpperCase()} import error:`, (err as Error).message);
    res.status(500).json({ error: 'Import mislukt' });
  }
}

router.post('/exercises/import', express.text({ type: 'text/xml', limit: '5mb' }), async (req, res) => {
  const xml: unknown = req.body;
  if (!xml || typeof xml !== 'string') {
    return res.status(400).json({ error: 'Geen TCX data ontvangen' });
  }
  await sendImport(res, { kind: 'tcx', xml });
});

// Polar JSON data export import
router.post('/exercises/import-json', express.json({ limit: '10mb' }), async (req, res) => {
  const session: ExportSession | undefined = req.body;
  if (!session?.exercises?.length) {
    return res.status(400).json({ error: 'Geen training sessie gevonden in JSON' });
  }
  await sendImport(res, { kind: 'json', session });
});

export default router;
