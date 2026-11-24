import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import type { ProjectMemoryHit, ProjectMemoryIndexStatus, ProjectMemorySearch, ProjectMemorySearchInput, ProjectMemorySourceDetail, ProjectMemorySourceInput, ProjectMemorySourceKind } from '../shared/project-memory-index';
import { searchSessionTranscripts } from './session-search';
import type { StudioStore } from './store';

const runFile = promisify(execFile);
const SOURCE_FILE_LIMIT = 180;
const SOURCE_CHAR_LIMIT = 1_500_000;
const FILE_BYTE_LIMIT = 64_000;
const PASSAGES_PER_FILE = 4;
const SOURCE_EXTENSIONS = /\.(?:c|cc|cpp|cs|css|go|html|java|js|jsx|json|md|mjs|py|rs|scss|sql|svelte|ts|tsx|vue|yaml|yml)$/i;
const EXCLUDED_PATH = /(^|\/)(?:\.git|\.next|\.venv|__snapshots__|build|coverage|dist|fixtures?|node_modules|out|test|tests|vendor)(\/|$)|(?:^|\/)(?:\.env(?:\.|$)|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$)/i;
const inProgress = new Map<string, Promise<ProjectMemoryIndexStatus>>();

interface SourceRow {
  kind: Exclude<ProjectMemorySourceKind, 'conversation'>;
  source_id: string;
  title: string;
  snippet: string;
  updated_at: string;
  git_ref: string | null;
  source_path: string | null;
}
interface StateRow {
  git_ref: string | null;
  repository: string | null;
  indexed_at: string;
  state: ProjectMemoryIndexStatus['state'];
  code_files_seen: number;
  code_files_indexed: number;
  warning: string | null;
}
interface TreeFile { path: string; hash: string; size: number }
interface IndexedSource { kind: 'commit' | 'code'; sourceId: string; title: string; body: string; updatedAt: string; path: string | null }

export function installProjectMemoryIndex(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_memory_sources (
      id INTEGER PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('task', 'commit', 'code')),
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      git_ref TEXT,
      source_path TEXT,
      fingerprint TEXT NOT NULL,
      UNIQUE(project_id, kind, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_sources_project ON project_memory_sources(project_id, kind, updated_at DESC);
    CREATE TABLE IF NOT EXISTS project_memory_index_state (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      git_ref TEXT,
      repository TEXT,
      indexed_at TEXT NOT NULL,
      state TEXT NOT NULL,
      code_files_seen INTEGER NOT NULL,
      code_files_indexed INTEGER NOT NULL,
      warning TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_source_fts USING fts5(
      title, body, content='project_memory_sources', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS project_memory_fts_insert AFTER INSERT ON project_memory_sources BEGIN
      INSERT INTO project_memory_source_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS project_memory_fts_update AFTER UPDATE ON project_memory_sources BEGIN
      INSERT INTO project_memory_source_fts(project_memory_source_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO project_memory_source_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS project_memory_fts_delete AFTER DELETE ON project_memory_sources BEGIN
      INSERT INTO project_memory_source_fts(project_memory_source_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END;
  `);
}

function fingerprint(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function putSource(db: Database.Database, projectId: string, item: IndexedSource | { kind: 'task'; sourceId: string; title: string; body: string; updatedAt: string; path: null }, gitRef: string | null): void {
  const digest = fingerprint([item.kind, item.sourceId, item.title, item.body, gitRef ?? '', item.path ?? ''].join('\0'));
  db.prepare(`INSERT INTO project_memory_sources (project_id, kind, source_id, title, body, updated_at, git_ref, source_path, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, kind, source_id) DO UPDATE SET title=excluded.title, body=excluded.body,
      updated_at=excluded.updated_at, git_ref=excluded.git_ref, source_path=excluded.source_path, fingerprint=excluded.fingerprint
    WHERE project_memory_sources.fingerprint != excluded.fingerprint`).run(projectId, item.kind, item.sourceId, item.title, item.body, item.updatedAt, gitRef, item.path, digest);
}

function syncTasks(store: StudioStore, projectId: string): void {
  store.db.transaction(() => {
    store.db.prepare("DELETE FROM project_memory_sources WHERE project_id = ? AND kind = 'task' AND source_id NOT IN (SELECT id FROM cards WHERE project_id = ?)").run(projectId, projectId);
    const rows = store.db.prepare('SELECT id, title, description, priority, labels_json, updated_at FROM cards WHERE project_id = ?').all(projectId) as Array<{ id: string; title: string; description: string; priority: string; labels_json: string; updated_at: string }>;
    for (const row of rows) putSource(store.db, projectId, { kind: 'task', sourceId: row.id, title: row.title, body: `${row.description}\n${row.priority}\n${row.labels_json}`, updatedAt: row.updated_at, path: null }, null);
  })();
}

async function git(cwd: string, args: string[], maxBuffer = 3_000_000): Promise<string> {
  const result = await runFile('git', ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args], {
    cwd, encoding: 'utf8', timeout: 8_000, maxBuffer, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return result.stdout;
}

async function baseCommit(cwd: string): Promise<string> {
  for (const candidate of ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/heads/main', 'refs/remotes/origin/master', 'refs/heads/master', 'HEAD']) {
    try { return (await git(cwd, ['rev-parse', '--verify', `${candidate}^{commit}`])).trim(); }
    catch { /* Try the next available local reference. */ }
  }
  throw new Error('No readable Git commit');
}

function treeFiles(output: string, prefix: string): TreeFile[] {
  const files: TreeFile[] = [];
  for (const record of output.split('\0')) {
    const match = record.match(/^[0-7]{6} blob ([a-f0-9]{40,64})\s+(\d+)\t(.+)$/s);
    if (!match) continue;
    const path = match[3]!;
    if (prefix && !path.startsWith(prefix)) continue;
    if (!SOURCE_EXTENSIONS.test(path) || EXCLUDED_PATH.test(path) || path.includes('\\') || path.includes('\0') || path.startsWith('/') || path.split('/').includes('..')) continue;
    const size = Number(match[2]);
    if (size > FILE_BYTE_LIMIT || size < 1) continue;
    files.push({ hash: match[1]!, size, path });
  }
  return files.sort((a, b) => {
    const priority = (path: string) => /(^|\/)src\//.test(path) ? 0 : /(^|\/)docs?\//.test(path) ? 1 : 2;
    return priority(a.path) - priority(b.path) || a.path.localeCompare(b.path);
  });
}

function passages(path: string, text: string, updatedAt: string): { rows: IndexedSource[]; truncated: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows: IndexedSource[] = [];
  let line = 0;
  while (line < lines.length && rows.length < PASSAGES_PER_FILE) {
    const start = line;
    let content = '';
    while (line < lines.length && line - start < 100 && content.length + lines[line]!.length < 5_000) content += `${lines[line++]}\n`;
    if (line === start) { content = lines[line++]!.slice(0, 5_000); }
    if (content.trim()) rows.push({ kind: 'code', sourceId: `${path}#${start + 1}`, title: `${path}:${start + 1}-${line}`, body: content, updatedAt, path });
  }
  return { rows, truncated: line < lines.length };
}

async function scanGit(cwd: string): Promise<{ repository: string; gitRef: string; sources: IndexedSource[]; codeFilesSeen: number; codeFilesIndexed: number; partial: boolean }> {
  const repository = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const prefix = (await git(cwd, ['rev-parse', '--show-prefix'])).trim();
  const gitRef = await baseCommit(cwd);
  const updatedAt = (await git(cwd, ['show', '-s', '--format=%cI', gitRef])).trim();
  const logArgs = ['log', '--no-show-signature', '--max-count=120', '--format=%H%x1f%cI%x1f%s%x1f%b%x1e', gitRef];
  if (prefix) logArgs.push('--', `:(top)${prefix}`);
  const output = await git(cwd, logArgs, 400_000);
  const sources: IndexedSource[] = [];
  for (const record of output.split('\x1e')) {
    const [hash, date, subject, body] = record.trim().split('\x1f');
    if (!hash || !/^[a-f0-9]{40,64}$/i.test(hash) || !date || !subject) continue;
    sources.push({ kind: 'commit', sourceId: hash, title: subject.slice(0, 300), body: `${subject}\n${body ?? ''}`.slice(0, 4_000), updatedAt: date, path: null });
  }
  const tree = treeFiles(await git(cwd, ['ls-tree', '--full-tree', '-r', '-l', '-z', gitRef]), prefix);
  let codeFilesIndexed = 0;
  let usedChars = 0;
  let partial = tree.length > SOURCE_FILE_LIMIT;
  const selected = tree.slice(0, SOURCE_FILE_LIMIT);
  for (let offset = 0; offset < selected.length && usedChars < SOURCE_CHAR_LIMIT; offset += 8) {
    const batch = selected.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (file) => {
      try { return await git(cwd, ['cat-file', 'blob', file.hash], FILE_BYTE_LIMIT + 8_000); }
      catch { return null; }
    }));
    for (let index = 0; index < batch.length; index += 1) {
      const text = results[index];
      if (text == null || text.includes('\0') || text.includes('\uFFFD')) { partial = true; continue; }
      const chunk = passages(batch[index]!.path, text, updatedAt);
      if (chunk.truncated) partial = true;
      for (const row of chunk.rows) {
        if (usedChars + row.body.length > SOURCE_CHAR_LIMIT) { partial = true; break; }
        sources.push(row);
        usedChars += row.body.length;
      }
      codeFilesIndexed += 1;
    }
  }
  if (codeFilesIndexed < selected.length) partial = true;
  return { repository, gitRef, sources, codeFilesSeen: tree.length, codeFilesIndexed, partial };
}

function saveState(store: StudioStore, projectId: string, input: Omit<StateRow, 'indexed_at'>): void {
  store.db.prepare(`INSERT INTO project_memory_index_state (project_id, git_ref, repository, indexed_at, state, code_files_seen, code_files_indexed, warning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET git_ref=excluded.git_ref, repository=excluded.repository,
      indexed_at=excluded.indexed_at, state=excluded.state, code_files_seen=excluded.code_files_seen,
      code_files_indexed=excluded.code_files_indexed, warning=excluded.warning`)
    .run(projectId, input.git_ref, input.repository, new Date().toISOString(), input.state, input.code_files_seen, input.code_files_indexed, input.warning);
}

export function projectMemoryIndexStatus(store: StudioStore, projectId: string): ProjectMemoryIndexStatus {
  store.project(projectId);
  const row = store.db.prepare('SELECT * FROM project_memory_index_state WHERE project_id = ?').get(projectId) as StateRow | undefined;
  const counts: ProjectMemoryIndexStatus['counts'] = { task: 0, conversation: 0, commit: 0, code: 0 };
  for (const item of store.db.prepare('SELECT kind, COUNT(*) AS count FROM project_memory_sources WHERE project_id = ? GROUP BY kind').all(projectId) as Array<{ kind: 'task' | 'commit' | 'code'; count: number }>) counts[item.kind] = item.count;
  counts.conversation = (store.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE project_id = ? AND state != 'running' AND output != ''").get(projectId) as { count: number }).count;
  return { projectId, state: row?.state ?? 'idle', indexedAt: row?.indexed_at ?? null, gitRef: row?.git_ref ?? null, counts, codeFilesSeen: row?.code_files_seen ?? 0, codeFilesIndexed: row?.code_files_indexed ?? 0, warning: row?.warning ?? null };
}

async function doRefresh(store: StudioStore, projectId: string): Promise<ProjectMemoryIndexStatus> {
  const project = store.project(projectId);
  syncTasks(store, projectId);
  try {
    const repository = (await git(project.path, ['rev-parse', '--show-toplevel'])).trim();
    const gitRef = await baseCommit(project.path);
    const old = store.db.prepare('SELECT * FROM project_memory_index_state WHERE project_id = ?').get(projectId) as StateRow | undefined;
    if (old?.git_ref === gitRef && old.repository === repository && (old.state === 'ready' || old.state === 'partial')) return projectMemoryIndexStatus(store, projectId);
    const scan = await scanGit(project.path);
    store.db.transaction(() => {
      store.db.prepare("DELETE FROM project_memory_sources WHERE project_id = ? AND kind IN ('commit', 'code')").run(projectId);
      for (const item of scan.sources) putSource(store.db, projectId, item, scan.gitRef);
      saveState(store, projectId, { git_ref: scan.gitRef, repository: scan.repository, state: scan.partial ? 'partial' : 'ready', code_files_seen: scan.codeFilesSeen, code_files_indexed: scan.codeFilesIndexed, warning: scan.partial ? 'Nicht alle getrackten Quelldateien wurden indexiert; Suche und Treffer zeigen nur den erfassten Teil.' : null });
    })();
  } catch {
    store.db.transaction(() => {
      store.db.prepare("DELETE FROM project_memory_sources WHERE project_id = ? AND kind IN ('commit', 'code')").run(projectId);
      saveState(store, projectId, { git_ref: null, repository: null, state: 'git-unavailable', code_files_seen: 0, code_files_indexed: 0, warning: 'Git-Historie oder Quellstand ist für dieses Projekt derzeit nicht lesbar.' });
    })();
  }
  return projectMemoryIndexStatus(store, projectId);
}

export function refreshProjectMemoryIndex(store: StudioStore, projectId: string): Promise<ProjectMemoryIndexStatus> {
  store.project(projectId);
  const current = inProgress.get(projectId);
  if (current) return current;
  const run = doRefresh(store, projectId).finally(() => { inProgress.delete(projectId); });
  inProgress.set(projectId, run);
  return run;
}

function matchExpression(query: string): string | null {
  if (typeof query !== 'string' || query.length > 160) throw new Error('Suchbegriff muss höchstens 160 Zeichen lang sein.');
  const terms = query.normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu)?.map((term) => term.toLocaleLowerCase('de-DE')).filter((term) => term.length >= 2).slice(0, 6) ?? [];
  return terms.length ? terms.map((term) => `"${term}"*`).join(' AND ') : null;
}

function cleanSnippet(value: string): string {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function searchProjectMemoryIndex(store: StudioStore, input: ProjectMemorySearchInput): ProjectMemorySearch {
  store.project(input.projectId);
  const kind = input.kind ?? 'all';
  if (!['all', 'task', 'conversation', 'commit', 'code'].includes(kind)) throw new Error('Ungültige Quelle.');
  const expression = matchExpression(input.query);
  const rows = expression
    ? store.db.prepare(`SELECT s.kind, s.source_id, s.title, s.updated_at, s.git_ref, s.source_path,
        snippet(project_memory_source_fts, 1, '', '', ' … ', 22) AS snippet
        FROM project_memory_source_fts JOIN project_memory_sources s ON s.id = project_memory_source_fts.rowid
        WHERE project_memory_source_fts MATCH ? AND s.project_id = ? AND (? = 'all' OR s.kind = ?)
        ORDER BY bm25(project_memory_source_fts), s.updated_at DESC LIMIT 24`).all(expression, input.projectId, kind, kind) as SourceRow[]
    : store.db.prepare(`SELECT kind, source_id, title, updated_at, git_ref, source_path, substr(body, 1, 220) AS snippet
        FROM project_memory_sources WHERE project_id = ? AND (? = 'all' OR kind = ?)
        ORDER BY updated_at DESC LIMIT 24`).all(input.projectId, kind, kind) as SourceRow[];
  const hits: ProjectMemoryHit[] = rows.map((row) => ({ kind: row.kind, sourceId: row.source_id, title: row.title, snippet: cleanSnippet(row.snippet), updatedAt: row.updated_at, gitRef: row.git_ref, path: row.source_path, cardId: row.kind === 'task' ? row.source_id : null, sessionId: null }));
  if (kind === 'all' || kind === 'conversation') {
    const sessions = expression ? searchSessionTranscripts(store.db, input.projectId, input.query).map((hit) => ({ sessionId: hit.sessionId, cardId: hit.cardId, title: hit.cardTitle, snippet: hit.snippet, updatedAt: hit.startedAt }))
      : store.db.prepare(`SELECT s.id AS sessionId, s.card_id AS cardId, c.title AS title, substr(s.output, 1, 220) AS snippet,
        COALESCE(s.ended_at, s.started_at) AS updatedAt FROM sessions s JOIN cards c ON c.id = s.card_id
        WHERE s.project_id = ? AND s.state != 'running' AND s.output != '' ORDER BY s.started_at DESC LIMIT 12`).all(input.projectId) as Array<{ sessionId: string; cardId: string; title: string; snippet: string; updatedAt: string }>;
    for (const item of sessions) hits.push({ kind: 'conversation', sourceId: item.sessionId, title: item.title, snippet: cleanSnippet(item.snippet), updatedAt: item.updatedAt, gitRef: null, path: null, cardId: item.cardId, sessionId: item.sessionId });
  }
  if (!expression) hits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { status: projectMemoryIndexStatus(store, input.projectId), hits: hits.slice(0, 30) };
}

export function readProjectMemorySource(store: StudioStore, input: ProjectMemorySourceInput): ProjectMemorySourceDetail | null {
  store.project(input.projectId);
  if (!['task', 'commit', 'code'].includes(input.kind) || typeof input.sourceId !== 'string' || input.sourceId.length > 600) throw new Error('Ungültige Quelle.');
  const row = store.db.prepare(`SELECT kind, source_id AS sourceId, title, body, updated_at AS updatedAt,
    git_ref AS gitRef, source_path AS path FROM project_memory_sources
    WHERE project_id = ? AND kind = ? AND source_id = ?`).get(input.projectId, input.kind, input.sourceId) as ProjectMemorySourceDetail | undefined;
  return row ?? null;
}
