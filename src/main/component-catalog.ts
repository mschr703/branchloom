import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import type { ComponentCandidate, ComponentCatalog } from '../shared/component-catalog';

const exec = promisify(execFile);
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 600;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATES = 200;
const MAX_MS = 3_000;
const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-main', 'build', 'coverage', 'out', 'vendor', '.next']);

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function trackedPath(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !value.startsWith('/') && !value.includes('\\')
    && !/[\x00-\x1f]/.test(value) && /\.(?:tsx|jsx)$/.test(value)
    && !/(?:^|\/)__tests__(?:\/|$)/.test(value)
    && !/\.(?:test|spec|stories)\.(?:tsx|jsx)$/.test(value)
    && value.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..' && !ignored.has(part.toLowerCase()));
}

class ScanInterrupted extends Error {}

function checkScanTime(deadline: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw new ScanInterrupted('Komponenteninventur wurde abgebrochen.');
  if (performance.now() >= deadline) throw new ScanInterrupted('Zeitlimit für die Inhaltsprüfung erreicht.');
}

async function readBounded(root: string, path: string, budget: number, deadline: number, signal?: AbortSignal): Promise<{ source: string; bytes: number } | null> {
  const candidate = resolve(root, path);
  if (!within(root, candidate)) return null;
  let segment = root;
  for (const part of path.split('/')) {
    checkScanTime(deadline, signal);
    segment = join(segment, part);
    if ((await lstat(segment)).isSymbolicLink()) return null;
  }
  checkScanTime(deadline, signal);
  const before = await lstat(candidate);
  if (!before.isFile() || before.size > MAX_FILE_BYTES || before.size > budget || !within(root, await realpath(candidate))) return null;
  checkScanTime(deadline, signal);
  const file = await open(candidate, 'r');
  try {
    checkScanTime(deadline, signal);
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_FILE_BYTES || opened.size > budget) return null;
    const buffer = Buffer.allocUnsafe(opened.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      checkScanTime(deadline, signal);
      const { bytesRead } = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    checkScanTime(deadline, signal);
    if (bytes !== opened.size) return null;
    return { source: buffer.toString('utf8', 0, bytes), bytes };
  } finally { await file.close(); }
}

/** Conservative exported-name inventory. It never imports or executes project code. */
export async function scanProjectComponents(projectPath: string, signal?: AbortSignal): Promise<ComponentCatalog> {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) throw new Error('Projektordner muss absolut sein.');
  if (signal?.aborted) throw new Error('Komponenteninventur wurde abgebrochen.');
  let root: string;
  try { root = await realpath(projectPath); if (!(await stat(root)).isDirectory()) throw new Error(); }
  catch { throw new Error('Projektordner ist nicht verfügbar.'); }
  let gitTop: string;
  try {
    const result = await exec('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024, windowsHide: true, shell: false, signal, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    gitTop = await realpath(result.stdout.trim());
  } catch { if (signal?.aborted) throw new Error('Komponenteninventur wurde abgebrochen.'); throw new Error('Komponenteninventur benötigt ein lokales Git-Repository.'); }
  const a = await stat(root); const b = await stat(gitTop);
  if (a.dev !== b.dev || a.ino !== b.ino) throw new Error('Komponenteninventur benötigt den Git-Wurzelordner als Projektordner.');
  let listed: string;
  try {
    listed = (await exec('git', ['-C', root, 'ls-files', '--cached', '--full-name', '-z'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: MAX_LIST_BYTES, windowsHide: true, shell: false,
      signal, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })).stdout;
  } catch { if (signal?.aborted) throw new Error('Komponenteninventur wurde abgebrochen.'); throw new Error('Versionierte Projektdateien konnten nicht begrenzt gelesen werden.'); }
  const paths = listed.split('\0').filter(trackedPath).sort((x, y) => x.localeCompare(y));
  const notes: string[] = [];
  let partial = false;
  if (paths.length > MAX_FILES) { partial = true; notes.push('Mehr als 600 TSX-/JSX-Dateien; nur die ersten wurden untersucht.'); }
  const candidates: ComponentCandidate[] = [];
  let scannedFiles = 0;
  let totalBytes = 0;
  const deadline = performance.now() + MAX_MS;
  for (const path of paths.slice(0, MAX_FILES)) {
    if (signal?.aborted) { partial = true; notes.push('Komponenteninventur wurde abgebrochen.'); break; }
    if (performance.now() >= deadline || totalBytes >= MAX_TOTAL_BYTES || candidates.length >= MAX_CANDIDATES) {
      partial = true; notes.push('Zeit-, Byte- oder Kandidatenlimit erreicht.'); break;
    }
    let read: { source: string; bytes: number } | null = null;
    try { read = await readBounded(root, path, MAX_TOTAL_BYTES - totalBytes, deadline, signal); }
    catch (reason) {
      if (reason instanceof ScanInterrupted) { partial = true; notes.push(reason.message); break; }
      /* Missing, replaced, symlinked or unreadable files are counted below. */
    }
    if (read === null) { partial = true; notes.push('Einige versionierte Dateien fehlten, waren zu groß, verknüpft oder nicht lesbar.'); continue; }
    scannedFiles += 1;
    totalBytes += read.bytes;
    const sourceFingerprint = createHash('sha256').update(read.source).digest('hex');
    const lines = read.source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const functionMatch = /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)\b/.exec(line);
      const constMatch = /^\s*export\s+const\s+([A-Z][A-Za-z0-9_]*)\b/.exec(line);
      const match = functionMatch ?? constMatch;
      if (!match) continue;
      // A JSX/React marker nearby makes this a useful candidate. It is not a parser or a proof of renderability.
      const nearby = lines.slice(index, Math.min(lines.length, index + 80)).join('\n').slice(0, 4_000);
      if (!/<[A-Za-z][A-Za-z0-9.:-]*(?:\s|>|\/)|React\.createElement\s*\(/.test(nearby)) continue;
      candidates.push({ name: match[1]!, path, line: index + 1, kind: functionMatch ? 'function' : 'const', sourceFingerprint });
      if (candidates.length >= MAX_CANDIDATES) { partial = true; notes.push('Maximal 200 Komponenten-Kandidaten werden gezeigt.'); break; }
    }
  }
  return { source: 'git-index', scannedFiles, candidates, partial, notes: [...new Set(notes)] };
}
