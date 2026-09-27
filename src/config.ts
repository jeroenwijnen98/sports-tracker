import 'dotenv/config';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every file-backed store lives under this directory. Tests point
// SPORTS_DATA_DIR at a temp directory so they never touch the real data.
export const DATA_DIR: string = process.env.SPORTS_DATA_DIR
  ? resolve(process.env.SPORTS_DATA_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), 'data');

const port = process.env.PORT || 3000;

export const config = {
  port,
  polar: {
    // Empty when .env is missing; the OAuth flow then fails at Polar.
    clientId: process.env.POLAR_CLIENT_ID ?? '',
    clientSecret: process.env.POLAR_CLIENT_SECRET ?? '',
    authUrl: 'https://flow.polar.com/oauth2/authorization',
    tokenUrl: 'https://polarremote.com/v2/oauth2/token',
    apiBase: 'https://www.polaraccesslink.com/v3',
    redirectUri: `http://localhost:${port}/auth/callback`,
  },
};
