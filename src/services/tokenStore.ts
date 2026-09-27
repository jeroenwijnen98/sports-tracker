import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../config.ts';

const TOKEN_PATH = join(DATA_DIR, 'token.json');

/** Polar's OAuth token response, stored as it came. It never expires. */
export interface PolarToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  /** The Polar user id, needed for the transaction flow. */
  x_user_id: number;
}

export async function getToken(): Promise<PolarToken | null> {
  try {
    const data = await readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveToken(tokenData: PolarToken): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
}

export async function deleteToken(): Promise<void> {
  try {
    await unlink(TOKEN_PATH);
  } catch {
    // File doesn't exist, that's fine
  }
}
