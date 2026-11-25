import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { TaskRevisionCleanupPreview } from '../shared/task-revisions';
import { reviewCardWorktree } from './git-worktree';
import { redactSensitiveText } from './sensitive-content';
import { taskRevisionHistory } from './task-revisions';
import type { StudioStore } from './store';

const MAX_FILES = 40;
const MAX_MATCHES = 24;
const MAX_FILE_BYTES = 64 * 1024;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.md', '.json', '.py', '.go', '.rs', '.java', '.cs', '.sql']);
const stopWords = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'build', 'both', 'only', 'required', 'this', 'that', 'oder', 'aber', 'auch', 'dass', 'eine', 'einen', 'einer', 'einem', 'alle', 'soll', 'sollen', 'wird', 'werden', 'nicht', 'mehr', 'noch', 'über', 'ohne', 'durch', 'damit', 'diese', 'dieser', 'dieses']);
const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu;
const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    maxBuffer: 512 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.error || result.status !== 0) throw new Error('Git could not inspect the card worktree for cleanup suggestions.');
  return result.stdout;
}

function words(text: string): string[] {
  return [...text.matchAll(wordPattern)].map((match) => match[0]!).filter((word) => !stopWords.has(word.toLocaleLowerCase()));
}

function lexicalChanges(fromTitle: string, fromDescription: string, toTitle: string, toDescription: string) {
  const nextWords = new Set(words(`${toTitle}\n${toDescription}`).map((word) => word.toLocaleLowerCase()));
  const oldWords = new Set(words(`${fromTitle}\n${fromDescription}`).map((word) => word.toLocaleLowerCase()));
  const oldOnly: TaskRevisionCleanupPreview['oldOnly'] = [];
  const seen = new Set<string>();
  for (const [source, value] of [['title', fromTitle], ['description', fromDescription]] as const) {
    for (const word of words(value)) {
      const key = word.toLocaleLowerCase();
      if (seen.has(key) || nextWords.has(key)) continue;
      seen.add(key);
      const line = value.split(/\r?\n/u).find((part) => words(part).some((item) => item.toLocaleLowerCase() === key)) ?? value;
      oldOnly.push({ term: word, source, excerpt: line.trim().slice(0, 220) });
      if (oldOnly.length >= 12) break;
    }
    if (oldOnly.length >= 12) break;
  }
  const retained = words(`${fromTitle}\n${fromDescription}`).filter((word, index, all) =>
    nextWords.has(word.toLocaleLowerCase()) && all.findIndex((item) => item.toLocaleLowerCase() === word.toLocaleLowerCase()) === index).slice(0, 12);
  const newOnly = words(`${toTitle}\n${toDescription}`).filter((word, index, all) =>
    !oldWords.has(word.toLocaleLowerCase()) && all.findIndex((item) => item.toLocaleLowerCase() === word.toLocaleLowerCase()) === index).slice(0, 12);
  return { oldOnly, retained, newOnly };
}

function safeFile(root: string, path: string): string | null {
  if (!path || path.includes('\\') || path.includes('\0') || isAbsolute(path) || path.split('/').some((part) => part === '..' || part === '.')) return null;
  if (!sourceExtensions.has(extname(path).toLocaleLowerCase())) return null;
  try {
    const target = resolve(root, path);
    const part = relative(realpathSync(root), realpathSync(target));
    if (!part || part === '..' || part.startsWith('../') || part.startsWith('..\\') || isAbsolute(part)
      || lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile()) return null;
    return target;
  } catch { return null; }
}

/** Read-only lexical hints. A match is a review target, never proof that code is obsolete. */
export function previewTaskRevisionCleanup(store: StudioStore, input: { projectId: string; cardId: string; revisionId: string }): TaskRevisionCleanupPreview {
  if (!input || typeof input.projectId !== 'string' || typeof input.cardId !== 'string' || typeof input.revisionId !== 'string')
    throw new Error('Invalid cleanup preview request.');
  const history = taskRevisionHistory(store, { projectId: input.projectId, cardId: input.cardId });
  const current = history.revisions[0];
  if (!current || current.id !== input.revisionId || current.committedContentRevision !== history.contentRevision)
    throw new Error('This task revision is no longer current. Open the latest card scope.');
  const lexical = lexicalChanges(current.fromTitle, current.fromDescription, current.toTitle, current.toDescription);
  const review = reviewCardWorktree(store, input.cardId);
  const result: TaskRevisionCleanupPreview = { revisionId: current.id, checkedAt: new Date().toISOString(), ...lexical,
    source: null, matches: [] };
  if (!review) return result;
  const baseHead = git(review.path, ['merge-base', review.targetHead, review.sourceHead]).trim();
  const changed = new Set([
    ...git(review.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '--diff-filter=ACMRT', '-z', baseHead, review.sourceHead]).split('\0').filter(Boolean),
    ...git(review.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '--diff-filter=ACMRT', '-z', 'HEAD']).split('\0').filter(Boolean),
  ]);
  const paths = [...changed].sort();
  const inspected = new Map<string, { path: string; hash: string }>();
  for (const path of paths.slice(0, MAX_FILES)) {
    const file = safeFile(review.path, path);
    if (!file) continue;
    if (lstatSync(file).size > MAX_FILE_BYTES) continue;
    const bytes = readFileSync(file);
    if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) continue;
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
    const fileHash = hash(bytes);
    inspected.set(path, { path: file, hash: fileHash });
    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      const lineWords = new Set(words(line).map((word) => word.toLocaleLowerCase()));
      for (const cue of lexical.oldOnly) {
        if (!lineWords.has(cue.term.toLocaleLowerCase())) continue;
        result.matches.push({ term: cue.term, path, line: index + 1,
          excerpt: redactSensitiveText(line.trim()).text.slice(0, 220), fileHash });
        if (result.matches.length >= MAX_MATCHES) break;
      }
      if (result.matches.length >= MAX_MATCHES) break;
    }
    if (result.matches.length >= MAX_MATCHES) break;
  }
  const after = reviewCardWorktree(store, input.cardId);
  if (!after || after.sourceHead !== review.sourceHead || after.targetHead !== review.targetHead
    || after.sourceStatus.join('\n') !== review.sourceStatus.join('\n'))
    throw new Error('The card worktree changed while checking cleanup candidates. Refresh the preview.');
  for (const [gitPath, entry] of inspected) {
    const fresh = safeFile(review.path, gitPath);
    if (fresh !== entry.path || !fresh || lstatSync(fresh).size > MAX_FILE_BYTES || hash(readFileSync(fresh)) !== entry.hash)
      throw new Error('A reviewed file changed while checking cleanup candidates. Refresh the preview.');
  }
  result.source = { head: review.sourceHead, targetHead: review.targetHead, baseHead,
    worktreeDirty: review.sourceStatus.length > 0, changedFileCount: paths.length,
    inspectedFileCount: inspected.size, truncated: paths.length > MAX_FILES || result.matches.length >= MAX_MATCHES };
  return result;
}
