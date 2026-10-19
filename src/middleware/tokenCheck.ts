import type { Request, Response, NextFunction } from 'express';
import { getToken } from '../services/tokenStore.ts';

export async function tokenCheck(req: Request, res: Response, next: NextFunction) {
  const token = await getToken();
  if (!token || !token.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.accessToken = token.access_token;
  req.polarUserId = token.x_user_id;
  next();
}

/** What `tokenCheck` put on the request, for a route behind it. */
export function polarAuth(req: Request): { accessToken: string; polarUserId: number } {
  const { accessToken, polarUserId } = req;
  if (accessToken === undefined) throw new Error('req.accessToken is missing: route not behind tokenCheck');
  if (polarUserId === undefined) throw new Error('req.polarUserId is missing: route not behind tokenCheck');
  return { accessToken, polarUserId };
}
