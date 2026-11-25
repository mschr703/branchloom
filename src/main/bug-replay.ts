import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import type { BugCaptureDraft, BugReplayAction, BugReplayResult, BugReplayTarget, BugScenario } from '../shared/bug-replay';
import { normalizeCardQaUrl } from './card-qa';
import { devEnvironmentProfile } from './dev-environment';
import { qaGitEvidence, qaGitPoint } from './qa-git-evidence';
import type { StudioStore } from './store';
import type { DevEnvironmentRunner } from './dev-environment';

const MAX_ACTIONS = 5;
const TARGET = /^[A-Za-z0-9_.:-]{1,80}$/;
const activeScenarios = new Set<string>();

type ScenarioRow = { id: string; project_id: string; card_id: string; url: string; width: number; height: number; actions_json: string; expectation_json: string; card_revision: number; environment_profile: string; created_at: string };
type RunRow = { id: string; scenario_id: string; card_id: string; project_id: string; status: BugReplayResult['status']; observed: string; requested_url: string; environment_run_id: string; checked_at: string; viewport_width: number; viewport_height: number; git_evidence_json: string };

function target(value: unknown): asserts value is BugReplayTarget {
  const item = value as Partial<BugReplayTarget> | null;
  if (!item || (item.kind !== 'test-id' && item.kind !== 'id') || typeof item.value !== 'string' || !TARGET.test(item.value)) {
    throw new Error('Verwende eine stabile data-testid oder Element-ID mit höchstens 80 Zeichen.');
  }
}

function validatedActions(value: unknown): BugReplayAction[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ACTIONS) throw new Error('Der Ablauf braucht einen bis fünf Schritte.');
  return value.map((item: unknown) => {
    const action = item as Partial<BugReplayAction> | null;
    if (action?.kind === 'click') { target(action.target); return { kind: 'click', target: { ...action.target } }; }
    if (action?.kind === 'resize' && Number.isSafeInteger(action.width) && Number.isSafeInteger(action.height)
      && action.width! >= 320 && action.width! <= 1920 && action.height! >= 240 && action.height! <= 1200) {
      return { kind: 'resize', width: action.width!, height: action.height! };
    }
    throw new Error('Der Ablauf enthält einen nicht unterstützten Schritt.');
  });
}

function scenarioFromRow(row: ScenarioRow): BugScenario {
  return { id: row.id, projectId: row.project_id, cardId: row.card_id, url: row.url, width: row.width, height: row.height,
    actions: validatedActions(JSON.parse(row.actions_json)), expectation: JSON.parse(row.expectation_json) as BugScenario['expectation'],
    cardRevision: row.card_revision, environmentProfile: row.environment_profile, createdAt: row.created_at };
}

function runFromRow(row: RunRow): BugReplayResult {
  return { id: row.id, scenarioId: row.scenario_id, cardId: row.card_id, projectId: row.project_id, status: row.status,
    observed: row.observed, requestedUrl: row.requested_url, environmentRunId: row.environment_run_id,
    checkedAt: row.checked_at, viewportWidth: row.viewport_width, viewportHeight: row.viewport_height,
    gitEvidence: JSON.parse(row.git_evidence_json) as BugReplayResult['gitEvidence'] };
}

export function installBugReplay(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS bug_scenarios (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    url TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    actions_json TEXT NOT NULL, expectation_json TEXT NOT NULL, card_revision INTEGER NOT NULL,
    environment_profile TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS bug_scenarios_card ON bug_scenarios(card_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS bug_scenario_runs (
    id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL REFERENCES bug_scenarios(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL, observed TEXT NOT NULL, requested_url TEXT NOT NULL,
    environment_run_id TEXT NOT NULL, checked_at TEXT NOT NULL, viewport_width INTEGER NOT NULL,
    viewport_height INTEGER NOT NULL, git_evidence_json TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS bug_scenario_runs_scenario ON bug_scenario_runs(scenario_id, checked_at DESC);`);
}

export function bugScenarios(store: StudioStore, cardId: string): BugScenario[] {
  store.card(cardId);
  return (store.db.prepare('SELECT * FROM bug_scenarios WHERE card_id = ? ORDER BY rowid DESC LIMIT 20').all(cardId) as ScenarioRow[]).map(scenarioFromRow);
}

export function bugScenarioRuns(store: StudioStore, scenarioId: string): BugReplayResult[] {
  const scenario = store.db.prepare('SELECT card_id FROM bug_scenarios WHERE id = ?').get(scenarioId) as { card_id: string } | undefined;
  if (!scenario) throw new Error('Der gespeicherte Ablauf fehlt.');
  store.card(scenario.card_id);
  return (store.db.prepare('SELECT * FROM bug_scenario_runs WHERE scenario_id = ? ORDER BY rowid DESC LIMIT 10').all(scenarioId) as RunRow[]).map(runFromRow);
}

/** A user may remove accidental steps, but cannot add actions that the capture did not observe. */
export function saveBugScenario(store: StudioStore, runner: DevEnvironmentRunner, capture: BugCaptureDraft, input: {
  cardId: string; actions: BugReplayAction[];
  expectation: { target: BugReplayTarget; state: 'visible' | 'hidden' };
}): BugScenario {
  const card = store.card(input.cardId);
  if (card.archivedAt || card.projectId !== capture.projectId) throw new Error('Die gewählte Karte gehört nicht zum Aufnahmeprojekt oder ist archiviert.');
  const revision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number }).content_revision;
  const actions = validatedActions(input.actions);
  let index = 0;
  for (const action of actions) {
    while (index < capture.actions.length && JSON.stringify(capture.actions[index]) !== JSON.stringify(action)) index++;
    if (index === capture.actions.length) throw new Error('Der bearbeitete Ablauf enthält einen nicht aufgenommenen Schritt.');
    index++;
  }
  target(input.expectation?.target);
  if (input.expectation.state !== 'visible' && input.expectation.state !== 'hidden') throw new Error('Wähle sichtbar oder verborgen als Erwartung.');
  const url = normalizeCardQaUrl(capture.url);
  if (new URL(url).search || new URL(url).hash) throw new Error('Die Aufnahme enthält Query oder Fragment.');
  if (!Number.isSafeInteger(capture.width) || capture.width < 320 || capture.width > 1920
    || !Number.isSafeInteger(capture.height) || capture.height < 240 || capture.height > 1200) throw new Error('Die Aufnahmegröße ist ungültig.');
  const current = runner.card(card.id);
  if (!current || current.state !== 'ready' || new URL(current.url).origin !== new URL(url).origin) throw new Error('Starte zuerst die zugehörige Karten-Vorschau auf derselben Origin.');
  runner.verifyCurrentPreview(card.id, current.id);
  const profile = devEnvironmentProfile(store, card.projectId);
  if (!profile) throw new Error('Das gespeicherte Entwicklungsprofil fehlt.');
  return store.db.transaction(() => {
    const after = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number }).content_revision;
    if (after !== revision) throw new Error('Die Karte hat sich während der Übernahme geändert.');
    const id = randomUUID();
    store.db.prepare(`INSERT INTO bug_scenarios (id, project_id, card_id, url, width, height, actions_json, expectation_json, card_revision, environment_profile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, card.projectId, card.id, url, capture.width, capture.height,
      JSON.stringify(actions), JSON.stringify(input.expectation), revision, profile.fingerprint, new Date().toISOString());
    return bugScenarios(store, card.id).find((item) => item.id === id)!;
  })();
}

type BrowserOutcome = { status: BugReplayResult['status']; observed: string; width: number; height: number };
export type BugReplayBrowser = (url: string, width: number, height: number, actions: BugReplayAction[], expectation: BugScenario['expectation'],
  verifyRequest: (url: string) => Promise<boolean>) => Promise<BrowserOutcome>;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const scriptForTarget = (item: BugReplayTarget): string => `(() => {
  const value = ${JSON.stringify(item.value)};
  const matches = ${item.kind === 'id' ? "[...document.querySelectorAll('[id]')].filter((element) => element.getAttribute('id') === value).slice(0, 2)" : "[...document.querySelectorAll('[data-testid]')].filter((element) => element.getAttribute('data-testid') === value).slice(0, 2)"};
  if (matches.length !== 1) return { count: matches.length, visible: false };
  const element = matches[0];
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const visible = box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    && Number(style.opacity) > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
  return { count: 1, visible, x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
})()`;

/** Browser input is limited to captured stable targets in one isolated loopback origin. */
export const electronBugReplayBrowser: BugReplayBrowser = async (url, width, height, actions, expectation, verifyRequest) => {
  const origin = new URL(url).origin;
  const qaWindow = new BrowserWindow({ show: false, width, height, useContentSize: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      webviewTag: false, backgroundThrottling: false, partition: `branchloom-bug-${randomUUID()}` } });
  let currentWidth = width; let currentHeight = height;
  let requestRejected = false;
  let timeout: NodeJS.Timeout | null = null;
  try {
    qaWindow.setContentSize(width, height);
    const contents = qaWindow.webContents;
    const qaSession = contents.session;
    qaSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    qaSession.setPermissionCheckHandler(() => false);
    qaSession.on('will-download', (event) => event.preventDefault());
    qaSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (details.method !== 'GET' && details.method !== 'HEAD') { requestRejected = true; callback({ cancel: true }); return; }
      void verifyRequest(details.url).then((allowed) => { if (!allowed) requestRejected = true; callback({ cancel: !allowed }); },
        () => { requestRejected = true; callback({ cancel: true }); });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrict = (event: Electron.Event & { url: string }): void => {
      try { if (new URL(event.url).origin === origin) return; } catch { /* blocked */ }
      requestRejected = true; event.preventDefault();
    };
    contents.on('will-navigate', restrict);
    contents.on('will-redirect', restrict);
    await Promise.race([contents.loadURL(url), new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Die lokale Vorschau antwortete nicht innerhalb von 15 Sekunden.')), 15_000);
    })]);
    if (timeout) { clearTimeout(timeout); timeout = null; }
    if (requestRejected) return { status: 'error', observed: 'Die Seite versuchte eine Anfrage außerhalb der freigegebenen Karten-Vorschau.', width: currentWidth, height: currentHeight };
    await wait(250);
    for (let step = 0; step < actions.length; step++) {
      const action = actions[step]!;
      if (action.kind === 'resize') {
        qaWindow.setContentSize(action.width, action.height);
        const size = qaWindow.getContentSize();
        if (size[0] !== action.width || size[1] !== action.height) return { status: 'error', observed: `Schritt ${step + 1}: Prüfgröße konnte nicht gesetzt werden.`, width: size[0] ?? 0, height: size[1] ?? 0 };
        currentWidth = action.width; currentHeight = action.height;
        await wait(200);
        continue;
      }
      const found = await contents.executeJavaScriptInIsolatedWorld(1017, [{ code: scriptForTarget(action.target) }]) as { count: number; visible: boolean; x?: number; y?: number };
      if (found.count !== 1 || !found.visible || !Number.isSafeInteger(found.x) || !Number.isSafeInteger(found.y)) return { status: 'error', observed: `Schritt ${step + 1}: Klickelement fehlt, ist mehrdeutig oder nicht sichtbar.`, width: currentWidth, height: currentHeight };
      contents.sendInputEvent({ type: 'mouseDown', x: found.x!, y: found.y!, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', x: found.x!, y: found.y!, button: 'left', clickCount: 1 });
      await wait(250);
      if (requestRejected) return { status: 'error', observed: `Schritt ${step + 1}: Eine Anfrage wurde durch die Vorschaugrenze blockiert.`, width: currentWidth, height: currentHeight };
      if (contents.isDestroyed() || new URL(contents.getURL()).origin !== origin) return { status: 'error', observed: `Schritt ${step + 1}: Seite hat die lokale Origin verlassen.`, width: currentWidth, height: currentHeight };
    }
    const found = await contents.executeJavaScriptInIsolatedWorld(1017, [{ code: scriptForTarget(expectation.target) }]) as { count: number; visible: boolean };
    if (requestRejected) return { status: 'error', observed: 'Eine Anfrage wurde während der Erwartungsprüfung blockiert.', width: currentWidth, height: currentHeight };
    if (found.count !== 1) return { status: 'error', observed: 'Das erwartete Element fehlt oder ist mehrdeutig.', width: currentWidth, height: currentHeight };
    const actual = found.visible ? 'visible' : 'hidden';
    return { status: actual === expectation.state ? 'passed' : 'failed',
      observed: `Erwartetes Element ist ${actual === 'visible' ? 'sichtbar' : 'verborgen'}.`,
      width: currentWidth, height: currentHeight };
  } finally { if (timeout) clearTimeout(timeout); if (!qaWindow.isDestroyed()) qaWindow.destroy(); }
};

/** Explicit replay against the currently owned F01 card preview; no automatic retry after a crash. */
export async function runBugScenario(store: StudioStore, runner: DevEnvironmentRunner, scenarioId: string,
  browser: BugReplayBrowser = electronBugReplayBrowser): Promise<BugReplayResult> {
  const row = store.db.prepare('SELECT * FROM bug_scenarios WHERE id = ?').get(scenarioId) as ScenarioRow | undefined;
  if (!row) throw new Error('Der gespeicherte Ablauf fehlt.');
  const scenario = scenarioFromRow(row);
  const card = store.card(scenario.cardId);
  if (card.archivedAt || card.projectId !== scenario.projectId) throw new Error('Die Szenario-Karte ist nicht mehr aktiv.');
  const revision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number }).content_revision;
  if (revision !== scenario.cardRevision) throw new Error('Der Kartenauftrag wurde geändert. Prüfe den Ablauf vor einer erneuten Ausführung.');
  const profile = devEnvironmentProfile(store, card.projectId);
  if (!profile || profile.fingerprint !== scenario.environmentProfile) throw new Error('Das Entwicklungsprofil hat sich geändert. Prüfe den Ablauf erneut.');
  if (activeScenarios.has(card.id)) throw new Error('Für diese Karte läuft bereits eine Fehlerprüfung.');
  const environment = runner.card(card.id);
  if (!environment) throw new Error('Starte zuerst die zugehörige Karten-Vorschau.');
  activeScenarios.add(card.id);
  try {
    const owned = await runner.verifyCurrentPreviewAsync(card.id, environment.id);
    const targetUrl = new URL(new URL(scenario.url).pathname, owned.url).href;
    const origin = new URL(owned.url).origin;
    const start = await qaGitPoint(store, card);
    let outcome: BrowserOutcome;
    try {
      outcome = await browser(targetUrl, scenario.width, scenario.height, scenario.actions, scenario.expectation, async (requested) => {
        try {
          if (new URL(requested).origin !== origin) return false;
          await runner.verifyCurrentPreviewAsync(card.id, owned.id);
          return true;
        } catch { return false; }
      });
    } catch (reason) {
      outcome = { status: 'error', observed: (reason instanceof Error ? reason.message : String(reason)).slice(0, 300), width: scenario.width, height: scenario.height };
    }
    try {
      const currentPreview = await runner.verifyCurrentPreviewAsync(card.id, owned.id);
      const currentCard = store.card(card.id);
      const currentRevision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number }).content_revision;
      const currentProfile = devEnvironmentProfile(store, card.projectId);
      if (currentPreview.url !== owned.url || currentCard.archivedAt || currentRevision !== scenario.cardRevision
        || currentProfile?.fingerprint !== scenario.environmentProfile) throw new Error('Replay prerequisites changed.');
    } catch {
      outcome = { status: 'error', observed: 'Karte, Entwicklungsprofil oder zugehörige Vorschau änderten sich während der Prüfung.',
        width: outcome.width, height: outcome.height };
    }
    const end = await qaGitPoint(store, card);
    const evidence = qaGitEvidence(start, end);
    const stable = evidence.state === 'clean';
    const result: BugReplayResult = { id: randomUUID(), scenarioId, cardId: card.id, projectId: card.projectId,
      status: outcome.status === 'passed' && !stable ? 'error' : outcome.status,
      observed: `${outcome.observed.slice(0, 240)}${outcome.status === 'passed' && !stable ? ' Checkout-Stand ist nicht sauber und stabil belegt.' : ''}`,
      requestedUrl: targetUrl,
      environmentRunId: owned.id, checkedAt: new Date().toISOString(), viewportWidth: outcome.width,
      viewportHeight: outcome.height, gitEvidence: evidence };
    store.db.prepare(`INSERT INTO bug_scenario_runs (id, scenario_id, card_id, project_id, status, observed, requested_url, environment_run_id, checked_at, viewport_width, viewport_height, git_evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(result.id, result.scenarioId, result.cardId, result.projectId,
      result.status, result.observed, result.requestedUrl, result.environmentRunId, result.checkedAt,
      result.viewportWidth, result.viewportHeight, JSON.stringify(result.gitEvidence));
    return result;
  } finally { activeScenarios.delete(card.id); }
}
