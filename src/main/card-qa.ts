import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import type { BrowserDiagnostic, Card, CardQaBatchResult, CardQaPageCheck, CardQaPageObservation, CardQaReport, CardQaViewport, ProjectQaCaptureIndex } from '../shared/types';
import { diagnosticSource, isLocalDevUrl, normalizeBrowserAddress } from './browser-policy';
import { inspectCardQaPage } from './card-qa-page';
import { qaGitEvidence, qaGitPoint } from './qa-git-evidence';
import type { QaGitEvidence } from '../shared/qa-git-evidence';
import type { StudioStore } from './store';

const MAX_FINDINGS = 20;
const MAX_REPORTS = 20;
const LOAD_TIMEOUT_MS = 15_000;
const SETTLE_MS = 900;
const MAX_SCREENSHOT_BYTES = 1_000_000;
const MAX_SCREENSHOTS = 100;
const MAX_ACTIVE_QA = 2;
const VIEWPORTS: Record<CardQaViewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const SCREENSHOT_WIDTH = 960;
const SCREENSHOT_HEIGHT = 600;
const SCREENSHOT_TIMEOUT_MS = 3_000;
const activeCards = new Set<string>();

type ReportRow = { id: string; card_id: string; project_id: string; requested_url: string; final_url: string | null; started_at: string; ended_at: string; status: CardQaReport['status']; diagnostics_json: string; page_check: CardQaPageCheck; page_observations_json: string; note: string | null; screenshot_available: number; viewport_width: number; viewport_height: number; git_evidence_json: string };
const reportFromRow = (row: ReportRow): CardQaReport => ({ id: row.id, cardId: row.card_id, projectId: row.project_id, requestedUrl: row.requested_url, finalUrl: row.final_url, startedAt: row.started_at, endedAt: row.ended_at, status: row.status, diagnostics: JSON.parse(row.diagnostics_json) as BrowserDiagnostic[], pageCheck: row.page_check, pageObservations: JSON.parse(row.page_observations_json) as CardQaPageObservation[], note: row.note, screenshotAvailable: row.screenshot_available === 1, viewportWidth: row.viewport_width, viewportHeight: row.viewport_height, gitEvidence: JSON.parse(row.git_evidence_json) as QaGitEvidence | null });
const reportColumns = 'id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, page_check, page_observations_json, note, viewport_width, viewport_height, git_evidence_json, CASE WHEN screenshot_png IS NOT NULL THEN 1 ELSE 0 END AS screenshot_available';

async function captureBounded(contents: Electron.WebContents): Promise<Buffer> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const capture = await Promise.race([
      contents.capturePage(),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('capture timeout')), SCREENSHOT_TIMEOUT_MS); }),
    ]);
    const size = capture.getSize();
    if (size.width < 1 || size.height < 1) throw new Error('empty');
    const scale = Math.min(1, SCREENSHOT_WIDTH / size.width, SCREENSHOT_HEIGHT / size.height);
    const image = scale < 1 ? capture.resize({ width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)) }) : capture;
    const bytes = image.toPNG();
    if (!bytes.length || bytes.length > MAX_SCREENSHOT_BYTES) throw new Error('size');
    return bytes;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function installCardQa(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS card_qa_reports (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requested_url TEXT NOT NULL, final_url TEXT, started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL, status TEXT NOT NULL, diagnostics_json TEXT NOT NULL, note TEXT,
    screenshot_png BLOB, viewport_width INTEGER NOT NULL DEFAULT 0, viewport_height INTEGER NOT NULL DEFAULT 0,
    page_check TEXT NOT NULL DEFAULT 'not-run', page_observations_json TEXT NOT NULL DEFAULT '[]',
    git_evidence_json TEXT NOT NULL DEFAULT 'null'
  ); CREATE INDEX IF NOT EXISTS card_qa_reports_card ON card_qa_reports(card_id, ended_at DESC);`);
  const columns = db.pragma('table_info(card_qa_reports)') as Array<{ name: string }>;
  if (!columns.some((item) => item.name === 'screenshot_png')) db.exec('ALTER TABLE card_qa_reports ADD COLUMN screenshot_png BLOB');
  if (!columns.some((item) => item.name === 'viewport_width')) db.exec('ALTER TABLE card_qa_reports ADD COLUMN viewport_width INTEGER NOT NULL DEFAULT 0');
  if (!columns.some((item) => item.name === 'viewport_height')) db.exec('ALTER TABLE card_qa_reports ADD COLUMN viewport_height INTEGER NOT NULL DEFAULT 0');
  if (!columns.some((item) => item.name === 'page_check')) db.exec("ALTER TABLE card_qa_reports ADD COLUMN page_check TEXT NOT NULL DEFAULT 'not-run'");
  if (!columns.some((item) => item.name === 'page_observations_json')) db.exec("ALTER TABLE card_qa_reports ADD COLUMN page_observations_json TEXT NOT NULL DEFAULT '[]'");
  if (!columns.some((item) => item.name === 'git_evidence_json')) db.exec("ALTER TABLE card_qa_reports ADD COLUMN git_evidence_json TEXT NOT NULL DEFAULT 'null'");
}

export function normalizeCardQaUrl(value: string): string {
  if (typeof value !== 'string') throw new Error('Gib die lokale Vorschau-Adresse ein.');
  const url = normalizeBrowserAddress(value);
  if (!isLocalDevUrl(url)) throw new Error('Auto-QA erlaubt nur localhost, 127.0.0.1 oder [::1].');
  return url;
}

export function cardQaReports(store: StudioStore, cardId: string): CardQaReport[] {
  store.card(cardId);
  return (store.db.prepare(`SELECT ${reportColumns} FROM card_qa_reports WHERE card_id = ? ORDER BY rowid DESC LIMIT ${MAX_REPORTS}`).all(cardId) as ReportRow[]).map(reportFromRow);
}

/** Recent stored images for a project's Design overview. No raw screenshot bytes cross this list IPC. */
export function listProjectQaCaptures(store: StudioStore, projectId: string): ProjectQaCaptureIndex {
  store.project(projectId);
  const rows = store.db.prepare(`SELECT id, card_id, requested_url, ended_at, status, viewport_width, viewport_height
    FROM card_qa_reports WHERE project_id = ? AND screenshot_png IS NOT NULL
    ORDER BY ended_at DESC, rowid DESC LIMIT 7`).all(projectId) as Array<{
      id: string; card_id: string; requested_url: string; ended_at: string; status: CardQaReport['status']; viewport_width: number; viewport_height: number;
    }>;
  return { items: rows.slice(0, 6).map((row) => ({ id: row.id, cardId: row.card_id, requestedUrl: diagnosticSource(row.requested_url) ?? '', endedAt: row.ended_at, status: row.status, viewportWidth: row.viewport_width, viewportHeight: row.viewport_height })), moreAvailable: rows.length > 6 };
}

export function cardQaScreenshot(store: StudioStore, input: { cardId: string; reportId: string }): string {
  store.card(input.cardId);
  const row = store.db.prepare('SELECT screenshot_png FROM card_qa_reports WHERE id = ? AND card_id = ?').get(input.reportId, input.cardId) as { screenshot_png: Buffer | null } | undefined;
  if (!row) throw new Error('QA-Bericht gehört nicht zu dieser Karte.');
  if (!Buffer.isBuffer(row.screenshot_png) || !row.screenshot_png.length || row.screenshot_png.length > MAX_SCREENSHOT_BYTES) throw new Error('Für diesen QA-Bericht ist kein gültiger Screenshot verfügbar.');
  return `data:image/png;base64,${row.screenshot_png.toString('base64')}`;
}

function persist(store: StudioStore, report: CardQaReport, screenshot: Buffer | null, contentRevision: number): CardQaReport {
  store.db.transaction(() => {
    store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, page_check, page_observations_json, note, screenshot_png, viewport_width, viewport_height, git_evidence_json, content_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(report.id, report.cardId, report.projectId, report.requestedUrl, report.finalUrl, report.startedAt, report.endedAt, report.status, JSON.stringify(report.diagnostics), report.pageCheck, JSON.stringify(report.pageObservations), report.note, screenshot, report.viewportWidth, report.viewportHeight, JSON.stringify(report.gitEvidence), contentRevision);
    store.db.prepare(`DELETE FROM card_qa_reports WHERE card_id = ? AND id NOT IN (
      SELECT id FROM card_qa_reports WHERE card_id = ? ORDER BY rowid DESC LIMIT ${MAX_REPORTS})`).run(report.cardId, report.cardId);
    store.db.prepare(`UPDATE card_qa_reports SET screenshot_png = NULL WHERE id IN (
      SELECT id FROM card_qa_reports WHERE screenshot_png IS NOT NULL ORDER BY rowid DESC LIMIT -1 OFFSET ${MAX_SCREENSHOTS})`).run();
  })();
  const saved = store.db.prepare(`SELECT ${reportColumns} FROM card_qa_reports WHERE id = ? AND card_id = ?`).get(report.id, report.cardId) as ReportRow;
  return reportFromRow(saved);
}

function reserveCard(cardId: string): void {
  if (activeCards.has(cardId)) throw new Error('Für diese Karte läuft bereits eine QA-Prüfung.');
  if (activeCards.size >= MAX_ACTIVE_QA) throw new Error('Es laufen bereits zwei lokale QA-Prüfungen. Warte auf deren Abschluss.');
  activeCards.add(cardId);
}

/** An explicit page-load QA pass in a fresh in-memory browser partition. The caller holds one per-card/global reservation. */
async function runReservedCardQa(store: StudioStore, card: Card, url: string, requestedViewport: { width: number; height: number }): Promise<CardQaReport> {
  const contentRevision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number }).content_revision;
  const startedAt = new Date().toISOString();
  const gitStart = await qaGitPoint(store, card);
  const diagnostics: BrowserDiagnostic[] = [];
  const origin = new URL(url).origin;
  const pushFinding = (kind: BrowserDiagnostic['kind'], rawMessage: string, rawSource: string, line: number | null): void => {
    const message = rawMessage.trim().slice(0, 2_000);
    if (!message) return;
    const sourceUrl = diagnosticSource(rawSource);
    if (diagnostics.some((item) => item.kind === kind && item.message === message && item.sourceUrl === sourceUrl && item.line === line)) return;
    diagnostics.push({ id: randomUUID(), kind, message, pageUrl: diagnosticSource(url)!, sourceUrl, line: Number.isSafeInteger(line) && line !== null && line > 0 ? line : null, capturedAt: new Date().toISOString() });
    if (diagnostics.length > MAX_FINDINGS) diagnostics.shift();
  };
  let qaWindow: BrowserWindow | null = null;
  let timeout: NodeJS.Timeout | null = null;
  let finalUrl: string | null = null;
  let note: string | null = null;
  let status: CardQaReport['status'] = 'error';
  let screenshot: Buffer | null = null;
  let pageCheck: CardQaPageCheck = 'not-run';
  let pageObservations: CardQaPageObservation[] = [];
  let contentViewport = { width: 0, height: 0 };
  try {
    qaWindow = new BrowserWindow({ show: false, width: requestedViewport.width, height: requestedViewport.height, useContentSize: true, webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      webviewTag: false, backgroundThrottling: false, partition: `branchloom-qa-${randomUUID()}`,
    } });
    qaWindow.setContentSize(requestedViewport.width, requestedViewport.height);
    const [contentWidth, contentHeight] = qaWindow.getContentSize();
    contentViewport = { width: contentWidth ?? 0, height: contentHeight ?? 0 };
    if (contentViewport.width !== requestedViewport.width || contentViewport.height !== requestedViewport.height) {
      throw new Error(`Die gewählte Prüfgröße konnte nicht gesetzt werden (${contentViewport.width} × ${contentViewport.height} statt ${requestedViewport.width} × ${requestedViewport.height} px).`);
    }
    const contents = qaWindow.webContents;
    const qaSession = contents.session;
    qaSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    qaSession.setPermissionCheckHandler(() => false);
    qaSession.on('will-download', (event) => event.preventDefault());
    qaSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allowed = false;
      try { allowed = new URL(details.url).origin === origin; } catch { /* blocked */ }
      if (!allowed) pushFinding('load', 'Anfrage außerhalb der lokalen Vorschau-Origin blockiert.', details.url, null);
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event: Electron.Event & { url: string }): void => {
      let allowed = false;
      try { allowed = new URL(event.url).origin === origin; } catch { /* blocked */ }
      if (!allowed) {
        pushFinding('load', 'Navigation außerhalb der lokalen Vorschau-Origin blockiert.', event.url, null);
        event.preventDefault();
      }
    };
    contents.on('will-navigate', restrictNavigation);
    contents.on('will-redirect', restrictNavigation);
    contents.on('console-message', (event) => { if (event.level === 'error') pushFinding('console', event.message, event.sourceId, event.lineNumber); });
    contents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3) pushFinding('load', `${description} (${code})`, failedUrl, null);
    });
    await Promise.race([
      contents.loadURL(url),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Lokale Vorschau antwortete nicht innerhalb von 15 Sekunden.')), LOAD_TIMEOUT_MS); }),
    ]);
    if (timeout) { clearTimeout(timeout); timeout = null; }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const [finalContentWidth, finalContentHeight] = qaWindow.getContentSize();
    contentViewport = { width: finalContentWidth ?? 0, height: finalContentHeight ?? 0 };
    const loaded = contents.getURL();
    finalUrl = diagnosticSource(loaded);
    if (contentViewport.width !== requestedViewport.width || contentViewport.height !== requestedViewport.height) {
      status = 'error'; note = `Die gewählte Prüfgröße änderte sich auf ${contentViewport.width} × ${contentViewport.height} px.`;
    } else if (!loaded || new URL(loaded).origin !== origin) {
      status = 'error'; note = 'Die Vorschau wurde nicht auf der erwarteten lokalen Origin geladen.';
    } else {
      status = diagnostics.length ? 'failed' : 'passed';
      try {
        const page = await inspectCardQaPage(contents);
        pageCheck = page.partial ? 'partial' : 'complete';
        pageObservations = page.observations;
      } catch {
        pageCheck = 'unavailable';
      }
      try {
        screenshot = await captureBounded(contents);
      } catch {
        note = 'Screenshot konnte nicht aufgenommen oder innerhalb des 1-MB-Limits gespeichert werden.';
      }
    }
  } catch (reason) {
    note = (reason instanceof Error ? reason.message : String(reason)).replaceAll(url, diagnosticSource(url)!);
    if (note.length > 2_000) note = note.slice(0, 2_000);
    status = 'error';
  } finally {
    if (timeout) clearTimeout(timeout);
    if (qaWindow && !qaWindow.isDestroyed()) qaWindow.destroy();
  }
  const gitEnd = await qaGitPoint(store, card);
  return persist(store, { id: randomUUID(), cardId: card.id, projectId: card.projectId, requestedUrl: diagnosticSource(url)!, finalUrl, startedAt, endedAt: new Date().toISOString(), status, diagnostics, pageCheck, pageObservations, note, screenshotAvailable: screenshot !== null, viewportWidth: contentViewport.width, viewportHeight: contentViewport.height, gitEvidence: qaGitEvidence(gitStart, gitEnd) }, screenshot, contentRevision);
}

/** One explicit route. The reservation is retained until its report has been stored. */
export async function runCardQa(store: StudioStore, input: { cardId: string; url: string; viewport: CardQaViewport }): Promise<CardQaReport> {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const url = normalizeCardQaUrl(input.url);
  if (typeof input.viewport !== 'string' || !Object.hasOwn(VIEWPORTS, input.viewport)) throw new Error('Wähle Desktop, Tablet oder Mobile als Prüfgröße.');
  reserveCard(card.id);
  try { return await runReservedCardQa(store, card, url, VIEWPORTS[input.viewport]); }
  finally { activeCards.delete(card.id); }
}

/** Explicit sequential check of at most five local routes, holding one card/global slot throughout. */
export async function runCardQaBatch(store: StudioStore, input: { cardId: string; urls: string[]; viewport: CardQaViewport }): Promise<CardQaBatchResult> {
  const card = store.card(input.cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 5) throw new Error('Wähle ein bis fünf lokale Routen.');
  if (typeof input.viewport !== 'string' || !Object.hasOwn(VIEWPORTS, input.viewport)) throw new Error('Wähle Desktop, Tablet oder Mobile als Prüfgröße.');
  const urls = input.urls.map(normalizeCardQaUrl);
  if (new Set(urls).size !== urls.length) throw new Error('Jede lokale Route darf im Lauf nur einmal vorkommen.');
  reserveCard(card.id);
  const reports: CardQaReport[] = [];
  let error: string | null = null;
  try {
    for (const url of urls) {
      try {
        if (store.card(card.id).archivedAt) throw new Error('Karte wurde während der Prüfung archiviert; übrige Routen nicht geprüft.');
        reports.push(await runReservedCardQa(store, card, url, VIEWPORTS[input.viewport]));
      } catch (reason) {
        error = (reason instanceof Error ? reason.message : String(reason)).replaceAll(url, diagnosticSource(url)!).slice(0, 500);
        break;
      }
    }
  } finally { activeCards.delete(card.id); }
  return { requested: urls.length, reports, error };
}
