import { randomUUID } from 'node:crypto';
import { WebContentsView, type BrowserWindow, type Session } from 'electron';
import type Database from 'better-sqlite3';
import type { BrowserBounds } from '../shared/types';
import type { DesignElementPreviewInput, DesignElementStyle, DesignInspectionState, DesignSelection, ThemePreviewInput } from '../shared/design-inspection';
import { normalizeDesignElementStyle } from '../shared/design-element-style';
import type { DesignA11yCheck } from '../shared/design-a11y';
import { a11yMeasurementScript, evaluateA11yMeasurement, type RawA11yMeasurement } from './design-a11y';
import { normalizeThemeTokenValue } from '../shared/theme-token-value';
import type { DesignViewportResult } from '../shared/design-viewports';
import { clampBrowserBounds, diagnosticSource, isLocalDevUrl, normalizeBrowserAddress } from './browser-policy';
import type { StudioStore } from './store';
import { scanThemeTokens } from './theme-tokens';
import { captureDesignViewports } from './design-viewports';

const MAX_SELECTIONS = 20;
const STYLE_KEYS = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'borderRadius', 'padding', 'display'] as const;
type SelectionDraft = Pick<DesignSelection, 'selector' | 'tag' | 'text' | 'styles' | 'tokens'>;
type SelectionRow = { id: string; project_id: string; source_url: string; selector: string; tag: string; text_snippet: string; styles_json: string; tokens_json: string; captured_at: string };
const fromRow = (row: SelectionRow): DesignSelection => ({ id: row.id, projectId: row.project_id, sourceUrl: row.source_url, selector: row.selector, tag: row.tag, text: row.text_snippet, styles: JSON.parse(row.styles_json) as Record<string, string>, tokens: JSON.parse(row.tokens_json) as DesignSelection['tokens'], capturedAt: row.captured_at });

export function installDesignInspection(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS design_selections (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL, selector TEXT NOT NULL, tag TEXT NOT NULL,
    text_snippet TEXT NOT NULL, styles_json TEXT NOT NULL, tokens_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS design_selections_project ON design_selections(project_id, captured_at DESC);`);
}

export function designSelections(store: StudioStore, projectId: string): DesignSelection[] {
  store.project(projectId);
  return (store.db.prepare(`SELECT * FROM design_selections WHERE project_id = ? ORDER BY rowid DESC LIMIT ${MAX_SELECTIONS}`).all(projectId) as SelectionRow[]).map(fromRow);
}

function shortText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function normalizeDesignSelection(value: unknown): SelectionDraft {
  if (!value || typeof value !== 'object') throw new Error('Elementdaten fehlen.');
  const item = value as Record<string, unknown>;
  const selector = shortText(item.selector, 320);
  const tag = shortText(item.tag, 32).toLowerCase();
  if (!selector || !/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error('Das Element lieferte keinen gültigen Selektor.');
  const rawStyles = item.styles && typeof item.styles === 'object' ? item.styles as Record<string, unknown> : {};
  const styles: Record<string, string> = {};
  for (const key of STYLE_KEYS) {
    const value = shortText(rawStyles[key], 160);
    if (value) styles[key] = value;
  }
  const tokens = Array.isArray(item.tokens) ? item.tokens.slice(0, 8).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const token = raw as Record<string, unknown>;
    const name = shortText(token.name, 80);
    const value = shortText(token.value, 160);
    return /^--[a-zA-Z0-9_-]+$/.test(name) && value ? [{ name, value }] : [];
  }) : [];
  return { selector, tag, text: shortText(item.text, 180), styles, tokens };
}

export function saveDesignSelection(store: StudioStore, projectId: string, sourceUrl: string, raw: unknown): DesignSelection {
  store.project(projectId);
  if (!isLocalDevUrl(sourceUrl)) throw new Error('Nur lokale Dev-Server-Seiten können als Designquelle gespeichert werden.');
  const item = normalizeDesignSelection(raw);
  const selection: DesignSelection = { id: randomUUID(), projectId, sourceUrl: diagnosticSource(sourceUrl)!, ...item, capturedAt: new Date().toISOString() };
  store.db.transaction(() => {
    store.db.prepare('INSERT INTO design_selections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(selection.id, projectId, selection.sourceUrl, selection.selector, selection.tag, selection.text, JSON.stringify(selection.styles), JSON.stringify(selection.tokens), selection.capturedAt);
    store.db.prepare(`DELETE FROM design_selections WHERE project_id = ? AND id NOT IN (SELECT id FROM design_selections WHERE project_id = ? ORDER BY rowid DESC LIMIT ${MAX_SELECTIONS})`).run(projectId, projectId);
  })();
  return selection;
}

export function normalizeDesignUrl(value: string): string {
  if (typeof value !== 'string') throw new Error('Gib eine lokale Vorschau-Adresse ein.');
  const url = normalizeBrowserAddress(value);
  if (!isLocalDevUrl(url)) throw new Error('Design-Inspektion erlaubt nur localhost, 127.0.0.1 oder [::1].');
  return url;
}

/** Only literal, request-free values may cross into a preview page as CSS. */
export function normalizeThemePreviewValue(value: unknown): string {
  return normalizeThemeTokenValue(value);
}

const inspectScript = (targetExpression: string): string => `(() => {
  const node = ${targetExpression};
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  const path = [];
  let current = node;
  for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
    const name = current.tagName.toLowerCase();
    let part = name;
    if (current.id) { part += '#' + CSS.escape(current.id.slice(0, 80)); path.unshift(part); break; }
    const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
    if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
    path.unshift(part);
  }
  const computed = getComputedStyle(node);
  const styles = {};
  for (const key of ${JSON.stringify(STYLE_KEYS)}) styles[key] = computed[key] || '';
  const tokens = [];
  for (let index = 0; index < Math.min(computed.length, 2048) && tokens.length < 8; index++) {
    const name = computed.item(index);
    if (name.startsWith('--')) { const value = computed.getPropertyValue(name).trim(); if (value) tokens.push({ name, value }); }
  }
  return { selector: path.join(' > '), tag, text: (node.textContent || '').slice(0, 240), styles, tokens };
})()`;

export class DesignInspector {
  private view: WebContentsView | null = null;
  private partitionSession: Session | null = null;
  private projectId: string | null = null;
  private sourceUrl: string | null = null;
  private visible = false;
  private bounds: BrowserBounds | null = null;
  private armed = false;
  private busy = false;
  private ready = false;
  private attached = false;
  private pageGeneration = 0;
  private themeBusy = false;
  private elementBusy = false;
  private viewportCapture: AbortController | null = null;
  private themePreview: { name: string; value: string; path: string; line: number; original: string; priority: string } | null = null;
  private elementPreview: { selectionId: string; selector: string; tag: string; text: string; sourceUrl: string; generation: number; values: DesignElementStyle; originals: Record<string, { value: string; priority: string }> } | null = null;
  private readonly preventDownload = (event: Electron.Event): void => event.preventDefault();
  private readonly resize = (): void => this.layout();

  constructor(private readonly window: BrowserWindow, private readonly store: StudioStore, private readonly emit: (selection: DesignSelection) => void) {
    window.on('resize', this.resize);
  }

  state(): DesignInspectionState { return { projectId: this.projectId, sourceUrl: this.sourceUrl ? diagnosticSource(this.sourceUrl) : null, ready: this.ready, armed: this.armed, themePreview: this.themePreview ? { name: this.themePreview.name, value: this.themePreview.value, path: this.themePreview.path, line: this.themePreview.line } : null, elementPreview: this.elementPreview ? { selectionId: this.elementPreview.selectionId, style: this.elementPreview.values } : null }; }

  async start(input: { projectId: string; url: string }): Promise<DesignInspectionState> {
    this.close();
    this.store.project(input.projectId);
    const url = normalizeDesignUrl(input.url);
    const view = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, partition: `branchloom-design-${randomUUID()}` } });
    this.view = view;
    this.projectId = input.projectId;
    this.sourceUrl = url;
    const origin = new URL(url).origin;
    const contents = view.webContents;
    contents.on('did-start-navigation', () => { this.pageGeneration++; this.themePreview = null; this.elementPreview = null; });
    const previewSession = contents.session;
    this.partitionSession = previewSession;
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    previewSession.setPermissionCheckHandler(() => false);
    previewSession.on('will-download', this.preventDownload);
    previewSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allowed = false;
      try { allowed = new URL(details.url).origin === origin; } catch { /* blocked */ }
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('before-input-event', (event) => event.preventDefault());
    contents.on('before-mouse-event', (event, mouse) => {
      if (mouse.type !== 'mouseDown' && mouse.type !== 'mouseUp' && mouse.type !== 'contextMenu') return;
      event.preventDefault();
      if (mouse.type !== 'mouseUp' || mouse.button !== 'left' || !this.armed || this.busy) return;
      this.armed = false;
      this.busy = true;
      void this.capture(contents, `document.elementFromPoint(${Math.floor(mouse.x)}, ${Math.floor(mouse.y)})`).then((selection) => {
        if (!selection && this.view?.webContents === contents && this.ready) this.armed = true;
      }).finally(() => { this.busy = false; });
    });
    this.layout();
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([contents.loadURL(url), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Die Vorschau antwortete nicht innerhalb von 15 Sekunden.')), 15_000); })]);
      if (this.view !== view) throw new Error('Die Vorschau wurde zwischenzeitlich geschlossen.');
      if (!contents.getURL() || new URL(contents.getURL()).origin !== origin) throw new Error('Die Vorschau verließ die gewählte lokale Origin.');
      this.ready = true;
      return this.state();
    } catch (reason) {
      if (this.view === view) this.close();
      throw reason;
    } finally { if (timeout) clearTimeout(timeout); }
  }

  arm(projectId: string): DesignInspectionState {
    if (!this.ready || !this.visible || !this.attached || this.projectId !== projectId) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    if (this.elementPreview) throw new Error('Setze zuerst den Elemententwurf zurück.');
    this.armed = true;
    return this.state();
  }

  async selectSelector(projectId: string, selector: string): Promise<DesignSelection> {
    if (!this.ready || !this.visible || !this.view || this.projectId !== projectId) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    if (typeof selector !== 'string' || !selector.trim() || selector.length > 320 || /[\u0000-\u001f\u007f]/.test(selector)) throw new Error('Gib einen CSS-Selektor mit höchstens 320 Zeichen ein.');
    if (this.busy) throw new Error('Eine Elementauswahl läuft bereits.');
    if (this.elementPreview) throw new Error('Setze zuerst den Elemententwurf zurück.');
    this.armed = false;
    this.busy = true;
    try {
      const selection = await this.capture(this.view.webContents, `document.querySelector(${JSON.stringify(selector.trim())})`);
      if (!selection) throw new Error('Der Selektor fand kein Element oder die Vorschau änderte sich.');
      return selection;
    } finally { this.busy = false; }
  }

  async checkA11y(projectId: string, selectionId: string): Promise<DesignA11yCheck> {
    const view = this.requireThemePreview(projectId);
    if (this.busy || this.themeBusy || this.viewportCapture) throw new Error('Warte, bis die laufende Design-Prüfung abgeschlossen ist.');
    if (typeof selectionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(selectionId)) throw new Error('Wähle einen gespeicherten Elementbeleg.');
    const selection = designSelections(this.store, projectId).find((item) => item.id === selectionId);
    if (!selection) throw new Error('Dieser Elementbeleg gehört nicht zu diesem Projekt oder wurde entfernt.');
    const contents = view.webContents;
    const pageUrl = contents.getURL();
    const generation = this.pageGeneration;
    if (diagnosticSource(pageUrl) !== selection.sourceUrl) throw new Error('Der Beleg stammt von einer anderen Route. Öffne sie und wähle das Element erneut aus.');
    const raw = await contents.executeJavaScript(a11yMeasurementScript(selection.selector), false) as RawA11yMeasurement;
    if (this.view !== view || contents.isDestroyed() || this.projectId !== projectId || this.pageGeneration !== generation || contents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während der Prüfung geändert. Starte die Messung erneut.');
    if (raw?.found && raw.tag !== selection.tag) throw new Error('Das Element hinter dem gespeicherten Selektor hat sich geändert. Wähle es erneut aus.');
    return evaluateA11yMeasurement({ projectId, selectionId, selector: selection.selector, sourceUrl: selection.sourceUrl }, raw);
  }

  async applyElementPreview(input: DesignElementPreviewInput): Promise<DesignInspectionState> {
    const style = normalizeDesignElementStyle(input?.style);
    const view = this.requireThemePreview(input?.projectId);
    if (this.elementBusy || this.busy || this.themeBusy || this.viewportCapture) throw new Error('Warte, bis die Design-Prüfung abgeschlossen ist.');
    if (this.elementPreview || this.themePreview) throw new Error('Setze zuerst die aktive Design-Vorschau zurück.');
    if (typeof input.selectionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.selectionId)) throw new Error('Wähle einen gespeicherten Elementbeleg.');
    const selection = designSelections(this.store, input.projectId).find((item) => item.id === input.selectionId);
    if (!selection) throw new Error('Dieser Elementbeleg gehört nicht zu diesem Projekt oder wurde entfernt.');
    const contents = view.webContents;
    const pageUrl = contents.getURL();
    const generation = this.pageGeneration;
    if (diagnosticSource(pageUrl) !== selection.sourceUrl) throw new Error('Der Beleg stammt von einer anderen Route. Öffne sie und wähle das Element erneut.');
    const entries = Object.entries(style).map(([key, value]): [string, string] => [key === 'backgroundColor' ? 'background-color' : key === 'borderRadius' ? 'border-radius' : key === 'fontSize' ? 'font-size' : key, value!]);
    this.elementBusy = true;
    try {
      const script = `(() => {
        let node; try { node = document.querySelector(${JSON.stringify(selection.selector)}); } catch { return { error: 'missing' }; }
        if (!node || node.tagName.toLowerCase() !== ${JSON.stringify(selection.tag)}) return { error: 'missing' };
        const text = (node.textContent || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 180);
        if (${JSON.stringify(selection.text)} && text !== ${JSON.stringify(selection.text)}) return { error: 'changed' };
        const entries = ${JSON.stringify(entries)};
        const originals = {};
        for (const [name, value] of entries) originals[name] = { value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name) };
        for (const [name, value] of entries) node.style.setProperty(name, value);
        const applied = Object.fromEntries(entries.map(([name]) => [name, node.style.getPropertyValue(name)]));
        if (entries.some(([name, value]) => applied[name] !== value)) {
          for (const [name] of entries) {
            const before = originals[name];
            if (before.value) node.style.setProperty(name, before.value, before.priority);
            else node.style.removeProperty(name);
          }
          return { error: 'rejected' };
        }
        return { originals, applied };
      })()`;
      const result = await contents.executeJavaScript(script, false) as { error?: string; originals?: Record<string, { value: string; priority: string }>; applied?: Record<string, string> };
      if (this.view !== view || contents.isDestroyed() || this.projectId !== input.projectId || this.pageGeneration !== generation || contents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während der Änderung geändert. Wähle das Element erneut.');
      if (result?.error === 'changed') throw new Error('Der Inhalt des ausgewählten Elements hat sich geändert. Wähle es erneut.');
      if (result?.error || !result?.originals || !result.applied || entries.some(([name, value]) => result.applied?.[name] !== value)) throw new Error('Das ausgewählte Element ist nicht mehr erreichbar. Wähle es erneut.');
      this.elementPreview = { selectionId: selection.id, selector: selection.selector, tag: selection.tag, text: selection.text, sourceUrl: selection.sourceUrl, generation, values: style, originals: result.originals };
      return this.state();
    } finally { this.elementBusy = false; }
  }

  async resetElementPreview(projectId: string): Promise<DesignInspectionState> {
    const view = this.requireThemePreview(projectId);
    if (this.elementBusy) throw new Error('Eine Elementvorschau läuft bereits.');
    const active = this.elementPreview;
    if (!active) return this.state();
    this.elementBusy = true;
    try {
      const contents = view.webContents;
      const pageUrl = contents.getURL();
      if (this.pageGeneration !== active.generation || diagnosticSource(pageUrl) !== active.sourceUrl) {
        this.elementPreview = null;
        throw new Error('Die Seite hat sich geändert. Der flüchtige Entwurf ist nicht mehr aktiv.');
      }
      const entries = Object.entries(active.values).map(([key, value]): [string, string] => [key === 'backgroundColor' ? 'background-color' : key === 'borderRadius' ? 'border-radius' : key === 'fontSize' ? 'font-size' : key, value!]);
      const script = `(() => {
        let node; try { node = document.querySelector(${JSON.stringify(active.selector)}); } catch { return false; }
        if (!node || node.tagName.toLowerCase() !== ${JSON.stringify(active.tag)}) return false;
        const text = (node.textContent || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 180);
        if (${JSON.stringify(active.text)} && text !== ${JSON.stringify(active.text)}) return false;
        const entries = ${JSON.stringify(entries)};
        if (entries.some(([name, value]) => node.style.getPropertyValue(name) !== value)) return false;
        const originals = ${JSON.stringify(active.originals)};
        for (const [name] of entries) {
          const before = originals[name];
          if (before.value) node.style.setProperty(name, before.value, before.priority);
          else node.style.removeProperty(name);
        }
        return true;
      })()`;
      const restored = await contents.executeJavaScript(script, false) as boolean;
      this.elementPreview = null;
      if (this.view !== view || contents.isDestroyed() || this.projectId !== projectId || this.pageGeneration !== active.generation || contents.getURL() !== pageUrl) throw new Error('Die Seite hat sich während des Zurücksetzens geändert.');
      if (!restored) throw new Error('Das Element oder sein Stil hat sich geändert. Der neue Seitenwert wurde nicht überschrieben.');
      return this.state();
    } finally { this.elementBusy = false; }
  }

  async applyThemePreview(input: ThemePreviewInput): Promise<DesignInspectionState> {
    if (this.viewportCapture) throw new Error('Warte, bis die Größenaufnahme abgeschlossen ist.');
    const { projectId, token } = input ?? ({} as ThemePreviewInput);
    const value = normalizeThemePreviewValue(input?.value);
    if (!token || typeof token.name !== 'string' || !/^--[A-Za-z0-9_-]{1,98}$/.test(token.name) ||
      typeof token.path !== 'string' || typeof token.line !== 'number' || typeof token.sourceFingerprint !== 'string') throw new Error('Wähle eine gefundene CSS-Variable.');
    const view = this.requireThemePreview(projectId);
    if (this.themeBusy || this.elementBusy) throw new Error('Eine Design-Vorschau läuft bereits.');
    if (this.themePreview || this.elementPreview) throw new Error('Setze zuerst die aktive Vorschau zurück.');
    this.themeBusy = true;
    try {
      const generation = this.pageGeneration;
      const pageUrl = view.webContents.getURL();
      const inventory = await scanThemeTokens(this.store, projectId);
      if (this.view !== view || this.pageGeneration !== generation || this.projectId !== projectId || view.webContents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während der Prüfung geändert.');
      if (!inventory.definitions.some((item) => item.name === token.name && item.path === token.path && item.line === token.line && item.sourceFingerprint === token.sourceFingerprint && item.value === token.value && item.valueTruncated === token.valueTruncated)) throw new Error('Die CSS-Fundstelle ist veraltet. Suche die Tokens erneut.');
      const script = `(() => { const root = document.documentElement; const name = ${JSON.stringify(token.name)}; const original = root.style.getPropertyValue(name); const priority = root.style.getPropertyPriority(name); root.style.setProperty(name, ${JSON.stringify(value)}); return { original, priority, applied: root.style.getPropertyValue(name) }; })()`;
      const result = await view.webContents.executeJavaScript(script, false) as { original: string; priority: string; applied: string };
      if (this.view !== view || this.pageGeneration !== generation || this.projectId !== projectId || view.webContents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während der Änderung geändert.');
      if (result.applied !== value) throw new Error('Die CSS-Variable konnte nicht angewendet werden.');
      this.themePreview = { name: token.name, value, path: token.path, line: token.line, original: result.original, priority: result.priority };
      return this.state();
    } finally { this.themeBusy = false; }
  }

  async resetThemePreview(projectId: string): Promise<DesignInspectionState> {
    const view = this.requireThemePreview(projectId);
    if (this.themeBusy || this.elementBusy) throw new Error('Eine Design-Vorschau läuft bereits.');
    const active = this.themePreview;
    if (!active) return this.state();
    this.themeBusy = true;
    try {
      const generation = this.pageGeneration;
      const pageUrl = view.webContents.getURL();
      const script = `(() => { const root = document.documentElement; const name = ${JSON.stringify(active.name)}; if (root.style.getPropertyValue(name) !== ${JSON.stringify(active.value)}) return false; const original = ${JSON.stringify(active.original)}; if (original) root.style.setProperty(name, original, ${JSON.stringify(active.priority)}); else root.style.removeProperty(name); return true; })()`;
      const restored = await view.webContents.executeJavaScript(script, false) as boolean;
      if (this.view !== view || this.pageGeneration !== generation || this.projectId !== projectId || view.webContents.getURL() !== pageUrl) throw new Error('Die Vorschau hat sich während des Zurücksetzens geändert.');
      this.themePreview = null;
      if (!restored) throw new Error('Die Seite hat den Wert selbst geändert. Der ursprüngliche Wert wurde nicht überschrieben.');
      return this.state();
    } finally { this.themeBusy = false; }
  }

  async captureViewports(projectId: string): Promise<DesignViewportResult> {
    if (!this.ready || !this.visible || !this.view || this.projectId !== projectId || !this.sourceUrl) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    if (this.themeBusy || this.elementBusy) throw new Error('Warte, bis die Design-Vorschau abgeschlossen ist.');
    if (this.themePreview || this.elementPreview) throw new Error('Setze die flüchtige Design-Vorschau vor der Größenaufnahme zurück.');
    if (this.viewportCapture) throw new Error('Eine Größenaufnahme läuft bereits.');
    const controller = new AbortController();
    const generation = this.pageGeneration;
    const sourceUrl = this.sourceUrl;
    this.viewportCapture = controller;
    try {
      const result = await captureDesignViewports(projectId, sourceUrl, controller.signal);
      if (controller.signal.aborted || this.pageGeneration !== generation || this.projectId !== projectId || this.sourceUrl !== sourceUrl) throw new Error('Größenaufnahme abgebrochen: Die Vorschau hat sich geändert.');
      return result;
    } finally {
      if (this.viewportCapture === controller) this.viewportCapture = null;
    }
  }

  cancelViewportCapture(projectId: string): void {
    if (this.projectId !== projectId) throw new Error('Die Design-Vorschau gehört zu einem anderen Projekt.');
    this.viewportCapture?.abort();
  }

  private requireThemePreview(projectId: string): WebContentsView {
    // The live view is detached while its viewport is scrolled off screen.
    // Theme controls sit below it and must still work on the open page.
    if (!this.ready || !this.visible || !this.view || this.view.webContents.isDestroyed() || this.projectId !== projectId) throw new Error('Öffne zuerst die lokale Design-Vorschau dieses Projekts.');
    return this.view;
  }

  setBounds(bounds: BrowserBounds | null): DesignInspectionState {
    this.bounds = clampBrowserBounds(bounds, this.window.getContentSize());
    this.layout();
    return this.state();
  }

  setVisible(visible: boolean): DesignInspectionState {
    this.visible = visible;
    if (!visible) this.close();
    else this.layout();
    return this.state();
  }

  close(): DesignInspectionState {
    this.viewportCapture?.abort();
    this.viewportCapture = null;
    this.pageGeneration++;
    this.themePreview = null;
    this.elementPreview = null;
    this.armed = false;
    this.ready = false;
    this.busy = false;
    if (this.view) {
      if (this.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    }
    if (this.partitionSession) {
      this.partitionSession.webRequest.onBeforeRequest(null);
      this.partitionSession.removeListener('will-download', this.preventDownload);
    }
    this.view = null;
    this.attached = false;
    this.partitionSession = null;
    this.projectId = null;
    this.sourceUrl = null;
    return this.state();
  }

  dispose(): void { this.close(); this.window.removeListener('resize', this.resize); }

  /** Observe native-view detachment in the isolated Electron smoke only. */
  smokeLayoutState(): { attached: boolean; visible: boolean; bounds: BrowserBounds | null; ready: boolean } {
    if (!process.argv.includes('--studio-smoke')) throw new Error('Design-Smoke-Status ist nicht verfügbar.');
    return { attached: this.attached, visible: this.visible, bounds: this.bounds, ready: this.ready };
  }

  /** Used only by the isolated source smoke to exercise Electron's real mouse path. */
  async smokeClick(selector: string): Promise<void> {
    if (!process.argv.includes('--studio-smoke') || !this.view || !this.ready || !this.armed) throw new Error('Design-Smoke-Klick ist nicht bereit.');
    const bounds = await this.view.webContents.executeJavaScript(`(() => { const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; })()`) as { x: number; y: number } | null;
    if (!bounds) throw new Error('Design-Smoke-Element fehlt.');
    const x = Math.floor(bounds.x), y = Math.floor(bounds.y);
    this.view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 });
    this.view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (await this.view.webContents.executeJavaScript('window.__designSmokeClicks') !== 0) throw new Error('Der Design-Auswahlklick wurde an die Vorschau-Seite weitergegeben.');
  }

  /** Real-Electron smoke observation; never available outside --studio-smoke. */
  async smokeThemeValue(selector: string, name: string): Promise<{ inline: string; computed: string }> {
    if (!process.argv.includes('--studio-smoke') || !this.view || !this.ready) throw new Error('Design-Smoke-Vorschau ist nicht bereit.');
    return this.view.webContents.executeJavaScript(`(() => { const root = document.documentElement; const element = document.querySelector(${JSON.stringify(selector)}); return { inline: root.style.getPropertyValue(${JSON.stringify(name)}), computed: element ? getComputedStyle(element).color : '' }; })()`) as Promise<{ inline: string; computed: string }>;
  }

  private async capture(contents: Electron.WebContents, targetExpression: string): Promise<DesignSelection | null> {
    const projectId = this.projectId;
    const sourceUrl = this.sourceUrl;
    if (!projectId || !sourceUrl || contents.isDestroyed()) return null;
    try {
      const raw = await contents.executeJavaScript(inspectScript(targetExpression), false);
      if (!raw || this.projectId !== projectId || this.view?.webContents !== contents || new URL(contents.getURL()).origin !== new URL(sourceUrl).origin) return null;
      const selection = saveDesignSelection(this.store, projectId, contents.getURL(), raw);
      this.emit(selection);
      return selection;
    } catch { return null; /* Page may navigate or close during selection; no record is invented. */ }
  }

  private layout(): void {
    if (!this.view || this.window.isDestroyed()) return;
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    if (!this.visible || !bounds) {
      if (this.attached) this.window.contentView.removeChildView(this.view);
      this.attached = false;
      return;
    }
    this.view.setBounds(bounds);
    if (!this.attached) { this.window.contentView.addChildView(this.view); this.attached = true; }
  }
}
