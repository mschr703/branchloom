import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ApiContractCardBinding, ApiContractCheck, ApiContractDraft, ApiContractField, ApiContractMismatch, ApiContractOverview, ApiContractPreview, ApiContractVersion } from '../shared/api-contract';
import type { StudioStore } from './store';

interface VersionRow { project_id: string; revision: number; fingerprint: string; draft_json: string; example_json: string; error_json: string; created_at: string }
interface BindingRow { card_id: string; revision: number; fingerprint: string; bound_at: string }
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const ROUTE = /^\/api(?:\/[A-Za-z0-9_-]+){1,6}$/;

export function installApiContracts(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS api_contract_versions (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0), fingerprint TEXT NOT NULL,
    draft_json TEXT NOT NULL, example_json TEXT NOT NULL, error_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(project_id, revision)
  );
  CREATE TABLE IF NOT EXISTS card_api_contract_bindings (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, bound_at TEXT NOT NULL,
    FOREIGN KEY(project_id, revision) REFERENCES api_contract_versions(project_id, revision) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS card_api_contract_bindings_project ON card_api_contract_bindings(project_id, revision);`);
  db.exec(`CREATE TABLE IF NOT EXISTS session_api_contract_snapshots (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL, revision INTEGER NOT NULL, fingerprint TEXT NOT NULL
  );`);
}

function normalizedDraft(input: ApiContractDraft): ApiContractDraft {
  if (!input || input.method !== 'GET' || typeof input.path !== 'string' || !ROUTE.test(input.path)) throw new Error('Use one GET route under /api, for example /api/items.');
  if (input.response !== 'object' && input.response !== 'array') throw new Error('Response must be an object or array.');
  if (!Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 16) throw new Error('Define 1 to 16 response fields.');
  const seen = new Set<string>();
  const fields: ApiContractField[] = input.fields.map((field, index) => {
    if (!field || typeof field.name !== 'string' || !FIELD_NAME.test(field.name) || field.name === '__proto__') throw new Error(`Field ${index + 1} needs a valid name.`);
    if (seen.has(field.name)) throw new Error(`Duplicate response field: ${field.name}.`);
    seen.add(field.name);
    if (!['string', 'number', 'boolean'].includes(field.type) || typeof field.required !== 'boolean') throw new Error(`Field ${field.name} has an invalid type or required flag.`);
    return { name: field.name, type: field.type, required: field.required };
  });
  const error = input.error;
  if (!error || !Number.isInteger(error.status) || error.status < 400 || error.status > 599 || typeof error.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) || typeof error.message !== 'string' || !error.message.trim() || error.message.length > 160 || /[\0\r\n]/.test(error.message)) throw new Error('Error case needs HTTP 400–599, an uppercase code, and a short message.');
  return { method: 'GET', path: input.path, response: input.response, fields, error: { status: error.status, code: error.code, message: error.message.trim() } };
}

function sample(draft: ApiContractDraft): unknown {
  const item: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of draft.fields) item[field.name] = field.type === 'string' ? `example_${field.name}` : field.type === 'number' ? 1 : true;
  return draft.response === 'array' ? [item] : item;
}
function fingerprint(draft: ApiContractDraft): string { return createHash('sha256').update(JSON.stringify(draft)).digest('hex'); }
function latestRevision(store: StudioStore, projectId: string): number {
  return (store.db.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM api_contract_versions WHERE project_id = ?').get(projectId) as { revision: number }).revision;
}
function version(row: VersionRow): ApiContractVersion {
  return { projectId: row.project_id, revision: row.revision, fingerprint: row.fingerprint,
    draft: JSON.parse(row.draft_json) as ApiContractDraft, example: JSON.parse(row.example_json) as unknown,
    errorExample: JSON.parse(row.error_json) as ApiContractVersion['errorExample'], expectedLatestRevision: row.revision - 1, createdAt: row.created_at };
}
function checkedVersion(store: StudioStore, projectId: string, revision: number): ApiContractVersion {
  store.project(projectId);
  const row = store.db.prepare('SELECT * FROM api_contract_versions WHERE project_id = ? AND revision = ?').get(projectId, revision) as VersionRow | undefined;
  if (!row) throw new Error('API contract revision not found in this project.');
  return version(row);
}

export function previewApiContract(store: StudioStore, input: { projectId: string; draft: ApiContractDraft }): ApiContractPreview {
  store.project(input.projectId);
  const draft = normalizedDraft(input.draft);
  return { draft, fingerprint: fingerprint(draft), expectedLatestRevision: latestRevision(store, input.projectId), example: sample(draft), errorExample: { error: { code: draft.error.code, message: draft.error.message } } };
}

export function saveApiContract(store: StudioStore, input: { projectId: string; draft: ApiContractDraft; fingerprint: string; expectedLatestRevision: number }): ApiContractVersion {
  return store.db.transaction(() => {
    const preview = previewApiContract(store, input);
    if (input.fingerprint !== preview.fingerprint || input.expectedLatestRevision !== preview.expectedLatestRevision) throw new Error('API contract preview is stale. Preview again before saving.');
    const revision = preview.expectedLatestRevision + 1;
    const createdAt = new Date().toISOString();
    store.db.prepare('INSERT INTO api_contract_versions (project_id, revision, fingerprint, draft_json, example_json, error_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.projectId, revision, preview.fingerprint, JSON.stringify(preview.draft), JSON.stringify(preview.example), JSON.stringify(preview.errorExample), createdAt);
    return { ...preview, projectId: input.projectId, revision, createdAt };
  })();
}

export function apiContractOverview(store: StudioStore, projectId: string): ApiContractOverview {
  store.project(projectId);
  const versions = (store.db.prepare('SELECT * FROM api_contract_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 50').all(projectId) as VersionRow[]).map(version);
  const latest = versions[0]?.revision ?? 0;
  const bindings = (store.db.prepare(`SELECT b.card_id, b.revision, v.fingerprint, b.bound_at FROM card_api_contract_bindings b
    JOIN api_contract_versions v ON v.project_id = b.project_id AND v.revision = b.revision WHERE b.project_id = ? ORDER BY b.bound_at DESC`).all(projectId) as BindingRow[])
    .map((row): ApiContractCardBinding => ({ cardId: row.card_id, revision: row.revision, fingerprint: row.fingerprint, current: row.revision === latest, boundAt: row.bound_at }));
  const cardRevisions = Object.fromEntries((store.db.prepare('SELECT id, content_revision FROM cards WHERE project_id = ? AND archived_at IS NULL').all(projectId) as Array<{ id: string; content_revision: number }>).map((row) => [row.id, row.content_revision]));
  return { versions, bindings, cardRevisions };
}

export function bindCardApiContract(store: StudioStore, input: { projectId: string; cardId: string; revision: number | null; expectedContentRevision: number }): ApiContractOverview {
  store.db.transaction(() => {
    store.project(input.projectId);
    const card = store.card(input.cardId);
    if (card.projectId !== input.projectId) throw new Error('Card belongs to another project.');
    if (card.archivedAt) throw new Error('Archived card cannot be bound.');
    const row = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
    if (!Number.isInteger(input.expectedContentRevision) || row.content_revision !== input.expectedContentRevision) throw new Error('Card changed. Reload before changing its API contract.');
    if (store.latestSession(card.id)?.state === 'running') throw new Error('Stop the running card session before changing its API contract.');
    if (input.revision !== null) {
      if (!Number.isInteger(input.revision) || input.revision !== latestRevision(store, input.projectId)) throw new Error('Only the latest API contract revision can be bound.');
      checkedVersion(store, input.projectId, input.revision);
      store.db.prepare(`INSERT INTO card_api_contract_bindings (card_id, project_id, revision, bound_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(card_id) DO UPDATE SET project_id = excluded.project_id, revision = excluded.revision, bound_at = excluded.bound_at`)
        .run(card.id, input.projectId, input.revision, new Date().toISOString());
    } else store.db.prepare('DELETE FROM card_api_contract_bindings WHERE card_id = ? AND project_id = ?').run(card.id, input.projectId);
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
  })();
  return apiContractOverview(store, input.projectId);
}

function kind(value: unknown): string { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }
function checkItem(fields: ApiContractField[], item: unknown, path: string, mismatches: ApiContractMismatch[]): void {
  if (kind(item) !== 'object') { mismatches.push({ path, expected: 'object', actual: kind(item) }); return; }
  const data = item as Record<string, unknown>;
  for (const field of fields) {
    if (!Object.hasOwn(data, field.name)) { if (field.required) mismatches.push({ path: `${path}.${field.name}`, expected: field.type, actual: 'missing' }); }
    else if (kind(data[field.name]) !== field.type) mismatches.push({ path: `${path}.${field.name}`, expected: field.type, actual: kind(data[field.name]) });
  }
  const allowed = new Set(fields.map((field) => field.name));
  for (const name of Object.keys(data)) if (!allowed.has(name)) mismatches.push({ path: `${path}.${name}`, expected: 'not defined', actual: 'present' });
}
export function checkApiContractResponse(store: StudioStore, input: { projectId: string; revision: number; status: number; responseText: string }): ApiContractCheck {
  const contract = checkedVersion(store, input.projectId, input.revision);
  if (typeof input.responseText !== 'string' || input.responseText.length > 32768) throw new Error('Response sample exceeds 32 KB.');
  let parsed: unknown;
  try { parsed = JSON.parse(input.responseText) as unknown; } catch { throw new Error('Response sample is not valid JSON.'); }
  const mismatches: ApiContractMismatch[] = [];
  if (!Number.isInteger(input.status)) throw new Error('HTTP status must be an integer.');
  if (input.status === 200) {
    if (kind(parsed) !== contract.draft.response) mismatches.push({ path: '$', expected: contract.draft.response, actual: kind(parsed) });
    else if (Array.isArray(parsed)) {
      if (parsed.length > 100) throw new Error('Response sample may contain at most 100 items.');
      parsed.forEach((item, index) => checkItem(contract.draft.fields, item, `$[${index}]`, mismatches));
    } else checkItem(contract.draft.fields, parsed, '$', mismatches);
  } else if (input.status === contract.draft.error.status) {
    if (kind(parsed) !== 'object' || kind((parsed as Record<string, unknown>).error) !== 'object') mismatches.push({ path: '$.error', expected: 'object', actual: kind(parsed) });
    else {
      const error = (parsed as { error: Record<string, unknown> }).error;
      if (error.code !== contract.draft.error.code) mismatches.push({ path: '$.error.code', expected: contract.draft.error.code, actual: typeof error.code === 'string' ? 'different string' : kind(error.code) });
      if (error.message !== contract.draft.error.message) mismatches.push({ path: '$.error.message', expected: contract.draft.error.message, actual: typeof error.message === 'string' ? 'different string' : kind(error.message) });
    }
  } else mismatches.push({ path: 'status', expected: `200 or ${contract.draft.error.status}`, actual: String(input.status) });
  return { revision: contract.revision, fingerprint: contract.fingerprint, current: contract.revision === latestRevision(store, input.projectId), valid: mismatches.length === 0, mismatches: mismatches.slice(0, 50) };
}

export function cardApiContractContext(store: StudioStore, cardId: string): string {
  const card = store.card(cardId);
  const row = store.db.prepare('SELECT revision FROM card_api_contract_bindings WHERE card_id = ? AND project_id = ?').get(card.id, card.projectId) as { revision: number } | undefined;
  if (!row) return '';
  const contract = checkedVersion(store, card.projectId, row.revision);
  if (contract.revision !== latestRevision(store, card.projectId)) throw new Error(`Card API contract revision ${contract.revision} is stale. Rebind it to the latest revision before starting an agent.`);
  return `Shared API contract (approved revision ${contract.revision}, sha256 ${contract.fingerprint}):\n${JSON.stringify({ method: contract.draft.method, path: contract.draft.path, successStatus: 200, response: contract.draft.response, fields: contract.draft.fields, errorStatus: contract.draft.error.status, error: contract.errorExample, successExample: contract.example }, null, 2)}\nUse this exact contract with the other bound cards. If implementation needs a change, request a new contract revision before diverging.`;
}

export function recordSessionApiContract(store: StudioStore, cardId: string, sessionId: string): void {
  const card = store.card(cardId);
  const row = store.db.prepare(`SELECT b.revision, v.fingerprint FROM card_api_contract_bindings b JOIN api_contract_versions v
    ON v.project_id = b.project_id AND v.revision = b.revision WHERE b.card_id = ? AND b.project_id = ?`)
    .get(card.id, card.projectId) as { revision: number; fingerprint: string } | undefined;
  if (row) store.db.prepare('INSERT INTO session_api_contract_snapshots (session_id, project_id, revision, fingerprint) VALUES (?, ?, ?, ?)')
    .run(sessionId, card.projectId, row.revision, row.fingerprint);
}

export function assertCardApiContractResume(store: StudioStore, cardId: string, previousSessionId: string): void {
  const card = store.card(cardId);
  const binding = store.db.prepare('SELECT revision FROM card_api_contract_bindings WHERE card_id = ? AND project_id = ?')
    .get(card.id, card.projectId) as { revision: number } | undefined;
  const previous = store.db.prepare('SELECT revision FROM session_api_contract_snapshots WHERE session_id = ? AND project_id = ?')
    .get(previousSessionId, card.projectId) as { revision: number } | undefined;
  if (binding?.revision !== previous?.revision) throw new Error('The API contract changed since this conversation. Start a new card session instead of resuming it.');
  if (binding) cardApiContractContext(store, cardId);
}
