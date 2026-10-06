import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';

/** Another process held the lock for longer than the wait allows. */
export class LockTimeoutError extends Error {
  constructor(path: string, waitedMs: number, holder: number | null) {
    const by = holder === null ? '' : ` by process ${holder}`;
    super(`${basename(path)} still held${by} after ${waitedMs} ms; nothing written`);
    this.name = 'LockTimeoutError';
  }
}

export interface WriteLockOptions {
  /** How long a write waits for another process to release the lock. */
  timeoutMs?: number;
  /** How often it looks again while waiting. */
  pollMs?: number;
  /**
   * A lock file whose holder cannot be read (cut off between create and
   * write) counts as stale once it is this old.
   */
  unreadableStaleMs?: number;
}

export interface WriteLock {
  /**
   * Run `write` after every write queued before it in this process, holding
   * the lock file meanwhile so no other process writes at the same time. The
   * queue and the lock are released whether `write` resolves or throws.
   */
  run<T>(write: () => Promise<T>): Promise<T>;
}

/** Whether a process with this id is running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it runs, under another user
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The process id written in a lock file, or null when it cannot be read. */
async function readHolder(path: string): Promise<number | null> {
  const pid = Number.parseInt((await readFile(path, 'utf-8')).split(' ')[0], 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * One in-process write queue plus a lock file at `path`, for writers that
 * may run in several processes (the server and `scripts/sync.ts`).
 *
 * The lock file is created exclusively and holds `<pid> <token>`. A writer
 * that finds it held waits, up to `timeoutMs`, then throws
 * `LockTimeoutError`. A lock whose process no longer runs is stale and
 * taken over. Two processes taking over the same stale lock at once could
 * both get it; with one server and one weekly sync that is left as it is.
 */
export function createWriteLock(path: string, options: WriteLockOptions = {}): WriteLock {
  const { timeoutMs = 10_000, pollMs = 50, unreadableStaleMs = 30_000 } = options;
  let queue: Promise<unknown> = Promise.resolve();

  /** Remove the lock file when its holder is gone, saying whether it did. */
  async function clearIfStale(): Promise<{ cleared: boolean; holder: number | null }> {
    let holder: number | null;
    try {
      holder = await readHolder(path);
      if (holder === null) {
        const age = Date.now() - (await stat(path)).mtimeMs;
        if (age < unreadableStaleMs) return { cleared: false, holder };
      } else if (isRunning(holder)) {
        return { cleared: false, holder };
      }
    } catch (err) {
      // Released between our failed create and this read: try again at once
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { cleared: true, holder: null };
      throw err;
    }
    console.log(`[lock] ${basename(path)} left by process ${holder ?? '?'}; taking it over`);
    await rm(path, { force: true });
    return { cleared: true, holder };
  }

  async function acquire(): Promise<string> {
    const token = `${process.pid} ${randomUUID()}`;
    const started = Date.now();
    await mkdir(dirname(path), { recursive: true });
    for (;;) {
      try {
        const file = await open(path, 'wx');
        try {
          await file.writeFile(token);
        } finally {
          await file.close();
        }
        return token;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      const { cleared, holder } = await clearIfStale();
      if (cleared) continue;
      const waited = Date.now() - started;
      if (waited >= timeoutMs) throw new LockTimeoutError(path, waited, holder);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /** Remove the lock file, unless it is no longer ours. */
  async function release(token: string): Promise<void> {
    try {
      if ((await readFile(path, 'utf-8')) !== token) return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    await rm(path, { force: true });
  }

  return {
    run<T>(write: () => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const token = await acquire();
        try {
          return await write();
        } finally {
          await release(token);
        }
      });
      // The next write waits for this one, whether it resolved or threw
      queue = result.catch(() => {});
      return result;
    },
  };
}
