import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../config.js';

const TOKEN_PATH = join(DATA_DIR, 'token.json');

export async function getToken() {
  try {
    const data = await readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveToken(tokenData) {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
}

export async function deleteToken() {
  try {
    await unlink(TOKEN_PATH);
  } catch {
    // File doesn't exist, that's fine
  }
}
