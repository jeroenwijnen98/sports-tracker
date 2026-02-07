import { Router } from 'express';
import { getAuthUrl, exchangeCode } from '../services/polarAuth.js';
import { getToken, deleteToken } from '../services/tokenStore.js';

const router = Router();

router.get('/login', (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?auth=error');
  }

  try {
    await exchangeCode(code);
    res.redirect('/?auth=success');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/?auth=error');
  }
});

router.get('/status', async (req, res) => {
  const token = await getToken();
  res.json({ authenticated: !!token?.access_token });
});

router.post('/logout', async (req, res) => {
  await deleteToken();
  res.json({ ok: true });
});

export default router;
