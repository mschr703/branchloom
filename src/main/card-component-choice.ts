import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { AddCardComponentChoice, AddCardComponentVariant, CardComponentChoice, CardComponentChoiceState, CardComponentVariant, ProjectComponentLibrary, ProjectComponentLibraryEntry } from '../shared/card-component-choice';
import type { StudioStore } from './store';
import { scanProjectComponents } from './component-catalog';
import { normalizeCardQaUrl } from './card-qa';
import { diagnosticSource } from './browser-policy';

interface ChoiceRow {
  id: string; card_id: string; project_id: string; name: string; path: string;
  line: number; source_fingerprint: string; purpose: string; added_at: string;
}
interface VariantRow { id: string; choice_id: string; card_id: string; label: string; preview_url: string; report_id: string; captured_at: string; source_fingerprint: string }
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_CHOICES = 6;
const MAX_LIBRARY_ROWS = 100;
const MAX_LIBRARY_ENTRIES = 20;
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
  db.exec(`CREATE TABLE IF NOT EXISTS card_component_variants (
    id TEXT PRIMARY KEY, choice_id TEXT NOT NULL REFERENCES card_component_choices(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label TEXT NOT NULL, preview_url TEXT NOT NULL, report_id TEXT NOT NULL,
    captured_at TEXT NOT NULL, source_fingerprint TEXT NOT NULL, screenshot_png BLOB NOT NULL,
    UNIQUE(choice_id, label)
  ); CREATE INDEX IF NOT EXISTS card_component_variants_choice ON card_component_variants(choice_id);`);
}

function rows(store: StudioStore, cardId: string): ChoiceRow[] {
  return store.db.prepare('SELECT * FROM card_component_choices WHERE card_id = ? ORDER BY added_at, id').all(cardId) as ChoiceRow[];
}

function variantRows(store: StudioStore, cardId: string): VariantRow[] {
  return store.db.prepare('SELECT id, choice_id, card_id, label, preview_url, report_id, captured_at, source_fingerprint FROM card_component_variants WHERE card_id = ? ORDER BY rowid').all(cardId) as VariantRow[];
}

function variantsFor(store: StudioStore, cardId: string, choiceId: string): CardComponentVariant[] {
  return variantRows(store, cardId).filter((row) => row.choice_id === choiceId).map((row) => ({
    id: row.id, label: row.label, previewUrl: row.preview_url, reportId: row.report_id,
    capturedAt: row.captured_at, sourceFingerprint: row.source_fingerprint,
  }));
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
    variants: variantsFor(store, cardId, row.id),
  })) };
}

/** Reuse only explicit choices from active cards in this project; never execute their source. */
export async function projectComponentLibrary(store: StudioStore, projectId: string): Promise<ProjectComponentLibrary> {
  const project = store.project(projectId);
  const catalog = await scanProjectComponents(project.path);
  const candidateKey = (item: { path: string; name: string; line: number; sourceFingerprint: string }) =>
    `${item.path}\0${item.name}\0${item.line}\0${item.sourceFingerprint}`;
  const candidates = new Map(catalog.candidates.map((item) => [candidateKey(item), item]));
  const sourceRows = store.db.prepare(`SELECT r.*, c.title AS card_title FROM card_component_choices r
    JOIN cards c ON c.id = r.card_id WHERE r.project_id = ? AND c.project_id = ? AND c.archived_at IS NULL
    ORDER BY r.added_at DESC, r.id DESC LIMIT ?`).all(projectId, projectId, MAX_LIBRARY_ROWS + 1) as Array<ChoiceRow & { card_title: string }>;
  const grouped = new Map<string, { entry: ProjectComponentLibraryEntry; cards: Set<string>; routes: Set<string> }>();
  for (const row of sourceRows.slice(0, MAX_LIBRARY_ROWS)) {
    const key = candidateKey({ path: row.path, name: row.name, line: row.line, sourceFingerprint: row.source_fingerprint });
    let group = grouped.get(key);
    if (!group) {
      group = { entry: { name: row.name, path: row.path, line: row.line, sourceFingerprint: row.source_fingerprint,
        purpose: row.purpose, sourceCardId: row.card_id, sourceCardTitle: row.card_title, usedByCards: 0,
        currentCandidate: candidates.get(key) ?? null, variants: [] }, cards: new Set<string>(), routes: new Set<string>() };
      grouped.set(key, group);
    }
    group.cards.add(row.card_id);
    for (const variant of variantsFor(store, row.card_id, row.id)) {
      if (group.entry.variants.length >= 2 || group.routes.has(variant.previewUrl)) continue;
      group.routes.add(variant.previewUrl);
      group.entry.variants.push({ ...variant, sourceCardId: row.card_id, sourceCardTitle: row.card_title });
    }
  }
  const entries = [...grouped.values()].slice(0, MAX_LIBRARY_ENTRIES).map(({ entry, cards }) =>
    ({ ...entry, usedByCards: cards.size }));
  return { projectId, entries, limited: sourceRows.length > MAX_LIBRARY_ROWS || grouped.size > MAX_LIBRARY_ENTRIES,
    catalogPartial: catalog.partial };
}

export function cardComponentVariantScreenshot(store: StudioStore, input: { cardId: string; variantId: string }): string {
  store.card(input.cardId);
  const row = store.db.prepare('SELECT screenshot_png FROM card_component_variants WHERE id = ? AND card_id = ?').get(input.variantId, input.cardId) as { screenshot_png: Buffer } | undefined;
  if (!row || !Buffer.isBuffer(row.screenshot_png) || row.screenshot_png.length < 1 || row.screenshot_png.length > 1_000_000) throw new Error('Variantenbild gehört nicht zu dieser Karte oder ist nicht verfügbar.');
  return `data:image/png;base64,${row.screenshot_png.toString('base64')}`;
}

export function addCardComponentVariant(store: StudioStore, input: AddCardComponentVariant): CardComponentChoiceState {
  if (!input || typeof input.cardId !== 'string' || typeof input.choiceId !== 'string' || typeof input.reportId !== 'string' ||
    !Number.isInteger(input.expectedContentRevision) || typeof input.label !== 'string' || input.label.trim().length < 2 ||
    input.label.trim().length > 60 || /[\x00-\x1f\x7f]/.test(input.label)) throw new Error('Variantenangaben sind ungültig.');
  store.db.transaction(() => {
    const card = store.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (revision(store, card.id) !== input.expectedContentRevision) throw new Error('Karte wurde geändert. Neu laden.');
    if (store.latestSession(card.id)?.state === 'running') throw new Error('Laufenden Kartenagenten zuerst beenden.');
    const choice = rows(store, card.id).find((row) => row.id === input.choiceId);
    if (!choice) throw new Error('Komponentenreferenz gehört nicht zu dieser Karte.');
    if (sourceFingerprint(store.project(card.projectId).path, choice.path) !== choice.source_fingerprint) throw new Error('Komponentenquelle hat sich geändert. Erneut auswählen.');
    const variants = variantRows(store, card.id).filter((row) => row.choice_id === choice.id);
    if (variants.length >= 2) throw new Error('Höchstens zwei Varianten pro Komponentenreferenz.');
    if (variants.some((row) => row.label.toLocaleLowerCase('de-DE') === input.label.trim().toLocaleLowerCase('de-DE'))) throw new Error('Variantenname ist bereits vergeben.');
    const report = store.db.prepare('SELECT card_id, project_id, requested_url, final_url, ended_at, status, content_revision, screenshot_png FROM card_qa_reports WHERE id = ? AND card_id = ?')
      .get(input.reportId, card.id) as { card_id: string; project_id: string; requested_url: string; final_url: string | null; ended_at: string; status: string; content_revision: number; screenshot_png: Buffer | null } | undefined;
    if (!report || report.project_id !== card.projectId || report.status !== 'passed' || !report.final_url ||
      !Buffer.isBuffer(report.screenshot_png) || report.screenshot_png.length < 1 || report.screenshot_png.length > 1_000_000) throw new Error('Für diese Karte fehlt eine erfolgreiche lokale Vorschau mit Screenshot.');
    const previewUrl = diagnosticSource(normalizeCardQaUrl(report.requested_url));
    if (!previewUrl) throw new Error('Lokale Beispielroute ist ungültig.');
    if (new URL(normalizeCardQaUrl(report.final_url)).origin !== new URL(report.requested_url).origin) throw new Error('Vorschau wurde von einer anderen Origin geladen.');
    if (report.content_revision !== input.expectedContentRevision) throw new Error('Die Vorschau stammt aus einer älteren Kartenrevision. Erneut prüfen.');
    if (variants.some((row) => row.preview_url === previewUrl)) throw new Error('Jede Variante braucht eine eigene Beispielroute ohne bloße Query-Unterschiede.');
    if (variantRows(store, card.id).some((row) => row.report_id === input.reportId)) throw new Error('Dieser Vorschaubericht ist schon einer Variante zugeordnet.');
    store.db.prepare('INSERT INTO card_component_variants (id, choice_id, card_id, label, preview_url, report_id, captured_at, source_fingerprint, screenshot_png) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), choice.id, card.id, input.label.trim(), previewUrl, input.reportId, report.ended_at, choice.source_fingerprint, report.screenshot_png);
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
  })();
  return cardComponentChoiceState(store, input.cardId);
}

export function removeCardComponentVariant(store: StudioStore, input: { cardId: string; variantId: string; expectedContentRevision: number }): CardComponentChoiceState {
  store.db.transaction(() => {
    const card = store.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (revision(store, card.id) !== input.expectedContentRevision) throw new Error('Karte wurde geändert. Neu laden.');
    if (store.latestSession(card.id)?.state === 'running') throw new Error('Laufenden Kartenagenten zuerst beenden.');
    const removed = store.db.prepare('DELETE FROM card_component_variants WHERE id = ? AND card_id = ?').run(input.variantId, card.id);
    if (removed.changes !== 1) throw new Error('Variante gehört nicht zu dieser Karte.');
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
  })();
  return cardComponentChoiceState(store, input.cardId);
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
    variants: variantsFor(store, cardId, row.id).map((item) => ({ label: item.label, previewUrl: item.previewUrl, qaReportId: item.reportId, capturedAt: item.capturedAt, sourceSha256: item.sourceFingerprint })),
  })), null, 2)}\nUse these existing components where appropriate. Do not silently substitute a changed source. Variant screenshots came from explicitly chosen local app routes; their association with the export was supplied by the user and is not statically verified.`;
}

function selectionFingerprint(store: StudioStore, cardId: string): string {
  return createHash('sha256').update(JSON.stringify(rows(store, cardId).map((row) => [row.name, row.path, row.line, row.source_fingerprint, row.purpose, variantsFor(store, cardId, row.id)]))).digest('hex');
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
