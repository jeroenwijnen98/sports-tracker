// @ts-check
import { spawn } from 'node:child_process';

/** The id of a process that has run and exited, so no process holds it. */
export async function exitedPid() {
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => child.on('exit', resolve));
  if (child.pid === undefined) throw new Error('child process did not start');
  return child.pid;
}
