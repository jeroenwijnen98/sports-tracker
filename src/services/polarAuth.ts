import { config } from '../config.ts';
import { saveToken } from './tokenStore.ts';
import type { PolarToken } from './tokenStore.ts';
import { polarRequest } from './polarApi.ts';

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.polar.clientId,
    redirect_uri: config.polar.redirectUri,
  });
  return `${config.polar.authUrl}?${params}`;
}

export async function exchangeCode(code: string): Promise<PolarToken> {
  const credentials = Buffer.from(
    `${config.polar.clientId}:${config.polar.clientSecret}`
  ).toString('base64');

  const res = await fetch(config.polar.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.polar.redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const tokenData: PolarToken = await res.json();
  await saveToken(tokenData);

  // Register user with Polar AccessLink
  await registerUser(tokenData.access_token, tokenData.x_user_id);

  return tokenData;
}

async function registerUser(accessToken: string, userId: number): Promise<void> {
  try {
    await polarRequest(accessToken, '/users', {
      method: 'POST',
      body: { 'member-id': String(userId) },
    });
  } catch {
    // User may already be registered, ignore errors
  }
}
