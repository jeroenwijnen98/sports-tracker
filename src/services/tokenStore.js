import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(__dirname, '..', 'data', 'token.json');

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
    const { unlink } = await import('node:fs/promises');
    await unlink(TOKEN_PATH);
  } catch {
    // File doesn't exist, that's fine
  }
}
