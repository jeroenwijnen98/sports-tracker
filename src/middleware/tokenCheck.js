import { getToken } from '../services/tokenStore.js';

export async function tokenCheck(req, res, next) {
  const token = await getToken();
  if (!token || !token.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.accessToken = token.access_token;
  req.polarUserId = token.x_user_id;
  next();
}
