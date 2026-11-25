import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { AddCardComponentChoice, CardComponentChoice, CardComponentChoiceState } from '../shared/card-component-choice';
import type { StudioStore } from './store';
import { scanProjectComponents } from './component-catalog';

interface ChoiceRow {
  id: string; card_id: string; project_id: string; name: string; path: string;
  line: number; source_fingerprint: string; purpose: string; added_at: string;
}
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_CHOICES = 6;
const PATH_PATTERN = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?\/)\S.{0,298}\.(?:tsx|jsx)$/;

export function installCardComponentChoices(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS card_component_choices (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL,
    source_fingerprint TEXT NOT NULL, purpose TEXT NOT NULL, added_at TEXT NOT NULL,
    UNIQUE(card_id, path, name)
  ); CREATE INDEX IF NOT EXISTS card_component_choices_card ON card_component_choices(card_id, added_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS session_component_choice_snapshots (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL
  );`);
}

function rows(store: StudioStore, cardId: string): ChoiceRow[] {
  return store.db.prepare('SELECT * FROM card_component_choices WHERE card_id = ? ORDER BY added_at, id').all(cardId) as ChoiceRow[];
}

/** Read only a tracked regular source inside the selected checkout. */
function sourceFingerprint(checkout: string, path: string): string | null {
  if (!PATH_PATTERN.test(path) || isAbsolute(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  try {
    const root = realpathSync(checkout);
    if (!statSync(root).isDirectory()) return null;
    let segment = root;
    for (const part of path.split('/')) {
      segment = join(segment, part);
      if (lstatSync(segment).isSymbolicLink()) return null;
    }
    const candidate = resolve(root, path);
    const inside = relative(root, candidate);
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
    const real = realpathSync(candidate);
    if (real !== candidate || !statSync(real).isFile() || statSync(real).size > MAX_SOURCE_BYTES) return null;
    const tracked = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', path], {
      encoding: 'utf8', timeout: 3_000, windowsHide: true, maxBuffer: 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (tracked.status !== 0) return null;
    return createHash('sha256').update(readFileSync(real, 'utf8')).digest('hex');
  } catch { return null; }
}

function revision(store: StudioStore, cardId: string): number {
  const row = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number };
  return row.content_revision;
}

export function cardComponentChoiceState(store: StudioStore, cardId: string): CardComponentChoiceState {
  const card = store.card(cardId);
  const checkout = store.project(card.projectId).path;
  return { cardId, contentRevision: revision(store, cardId), choices: rows(store, cardId).map((row): CardComponentChoice => ({
    id: row.id, cardId: row.card_id, projectId: row.project_id, name: row.name, path: row.path,
    line: row.line, sourceFingerprint: row.source_fingerprint, purpose: row.purpose,
    addedAt: row.added_at, current: sourceFingerprint(checkout, row.path) === row.source_fingerprint,
  })) };
}

function checkedPurpose(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300 || /[\x00-\x1f\x7f]/.test(value) || value.trim().length < 3) throw new Error('Verwendungshinweis braucht 3 bis 300 Zeichen ohne Steuerzeichen.');
  return value.trim();
}

export async function addCardComponentChoice(store: StudioStore, input: AddCardComponentChoice): Promise<CardComponentChoiceState> {
  if (!input || typeof input.cardId !== 'string' || !Number.isInteger(input.expectedContentRevision)
    || typeof input.name !== 'string' || !/^[A-Z][A-Za-z0-9_]*$/.test(input.name)
    || typeof input.path !== 'string' || !PATH_PATTERN.test(input.path)
    || !Number.isInteger(input.line) || input.line < 1
    || typeof input.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceFingerprint)) {
    throw new Error('Komponentenquelle ist ungültig. Erneut suchen.');
  }
  const purpose = checkedPurpose(input.purpose);
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const project = store.project(card.projectId);
  const catalog = await scanProjectComponents(project.path);
  const candidate = catalog.candidates.find((item) => item.path === input.path && item.name === input.name && item.line === input.line && item.sourceFingerprint === input.sourceFingerprint);
  if (!candidate) throw new Error('Komponentenquelle hat sich geändert oder wurde nicht gefunden. Erneut suchen.');
  store.db.transaction(() => {
    if (revision(store, card.id) !== input.expectedContentRevision) throw new Error('Karte wurde geändert. Neu laden.');
    if (store.latestSession(card.id)?.state === 'running') throw new Error('Laufenden Kartenagenten zuerst beenden.');
    if (rows(store, card.id).length >= MAX_CHOICES) throw new Error('Höchstens sechs Komponentenreferenzen pro Karte.');
    if (sourceFingerprint(project.path, input.path) !== input.sourceFingerprint) throw new Error('Komponentenquelle hat sich geändert. Erneut suchen.');
    store.db.prepare('INSERT INTO card_component_choices (id, card_id, project_id, name, path, line, source_fingerprint, purpose, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), card.id, card.projectId, input.name, input.path, input.line, input.sourceFingerprint, purpose, new Date().toISOString());
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
  })();
  return cardComponentChoiceState(store, card.id);
}

export function removeCardComponentChoice(store: StudioStore, input: { cardId: string; choiceId: string; expectedContentRevision: number }): CardComponentChoiceState {
  store.db.transaction(() => {
    const card = store.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (revision(store, card.id) !== input.expectedContentRevision) throw new Error('Karte wurde geändert. Neu laden.');
    if (store.latestSession(card.id)?.state === 'running') throw new Error('Laufenden Kartenagenten zuerst beenden.');
    const removed = store.db.prepare('DELETE FROM card_component_choices WHERE id = ? AND card_id = ? AND project_id = ?')
      .run(input.choiceId, card.id, card.projectId);
    if (removed.changes !== 1) throw new Error('Komponentenreferenz wurde nicht gefunden.');
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
  })();
  return cardComponentChoiceState(store, input.cardId);
}

function contextRows(store: StudioStore, cardId: string, checkout: string): ChoiceRow[] {
  const selected = rows(store, cardId);
  for (const row of selected) {
    if (sourceFingerprint(checkout, row.path) !== row.source_fingerprint) {
      throw new Error(`Komponentenreferenz ${row.name} in ${row.path} ist veraltet oder fehlt. Referenz prüfen und erneut auswählen.`);
    }
  }
  return selected;
}

export function cardComponentChoiceContext(store: StudioStore, cardId: string, checkout: string): string {
  store.card(cardId);
  const selected = contextRows(store, cardId, checkout);
  if (!selected.length) return '';
  return `Approved component references for this card (source files checked in this checkout):\n${JSON.stringify(selected.map((row) => ({
    name: row.name, importPath: row.path, sourceLine: row.line, sourceSha256: row.source_fingerprint, purpose: row.purpose,
  })), null, 2)}\nUse these existing components where appropriate. Do not silently substitute a changed source.`;
}

function selectionFingerprint(store: StudioStore, cardId: string): string {
  return createHash('sha256').update(JSON.stringify(rows(store, cardId).map((row) => [row.name, row.path, row.line, row.source_fingerprint, row.purpose]))).digest('hex');
}

export function recordSessionComponentChoices(store: StudioStore, cardId: string, sessionId: string): void {
  store.db.prepare('INSERT INTO session_component_choice_snapshots (session_id, fingerprint) VALUES (?, ?)')
    .run(sessionId, selectionFingerprint(store, cardId));
}

export function assertCardComponentChoiceResume(store: StudioStore, cardId: string, previousSessionId: string, checkout: string): void {
  cardComponentChoiceContext(store, cardId, checkout);
  const prior = store.db.prepare('SELECT fingerprint FROM session_component_choice_snapshots WHERE session_id = ?')
    .get(previousSessionId) as { fingerprint: string } | undefined;
  if (prior?.fingerprint !== selectionFingerprint(store, cardId) && (prior || rows(store, cardId).length)) {
    throw new Error('Die Komponentenreferenzen haben sich seit diesem Gespräch geändert. Neuen Kartenlauf starten.');
  }
}
