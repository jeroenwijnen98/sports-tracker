import { Router } from 'express';
import { tokenCheck } from '../middleware/tokenCheck.js';
import { getExercises, polarFetch } from '../services/polarApi.js';

const router = Router();

router.use(tokenCheck);

router.get('/exercises', async (req, res) => {
  try {
    const exercises = await getExercises(req.accessToken, req.polarUserId);
    res.json(exercises);
  } catch (err) {
    console.error('Exercises fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch exercises from Polar' });
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

export default router;
