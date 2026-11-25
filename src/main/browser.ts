import { randomUUID } from 'node:crypto';
import { ClipboardItem, clipboard, Menu, session, shell, WebContentsView, type BrowserWindow, type Session } from 'electron';
import type { BrowserBounds, BrowserCaptureResult, BrowserDiagnostic, BrowserState, BrowserTabState } from '../shared/types';
import type { BugCaptureDraft, BugDiagnosticReference, BugReplayAction } from '../shared/bug-replay';
import { clampBrowserBounds, diagnosticSource, isLocalDevUrl, isSafeBrowserUrl, normalizeBrowserAddress } from './browser-policy';
import { BrowserSessionPersistence, MAX_BROWSER_TABS } from './browser-persistence';

const PARTITION = 'persist:jarvis-studio-browser';
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const BUG_CAPTURE_WORLD = 1017;
const BUG_CAPTURE_START = `(() => {
  const key = '__branchloom_bug_capture';
  globalThis[key]?.stop();
  const clicks = [];
  let ignoredClicks = 0;
  const valid = /^[A-Za-z0-9_.:-]{1,80}$/;
  const onClick = (event) => {
    if (!event.isTrusted) return;
    const element = event.target instanceof Element ? event.target.closest('[data-testid], [id]') : null;
    const testId = element?.getAttribute('data-testid');
    const id = element?.id;
    const unique = (attribute, value) => {
      let found = null;
      for (const candidate of document.querySelectorAll('[' + attribute + ']')) {
        if (candidate.getAttribute(attribute) !== value) continue;
        if (found) return false;
        found = candidate;
      }
      return found === element;
    };
    const target = testId && valid.test(testId) && unique('data-testid', testId) ? { kind: 'test-id', value: testId }
      : id && valid.test(id) && unique('id', id) ? { kind: 'id', value: id } : null;
    if (!target || clicks.length >= 8) { ignoredClicks++; return; }
    clicks.push({ kind: 'click', target, at: Date.now() });
  };
  document.addEventListener('click', onClick, true);
  globalThis[key] = { stop() { document.removeEventListener('click', onClick, true); delete globalThis[key]; return { clicks, ignoredClicks }; } };
  return true;
})()`;
const BUG_CAPTURE_STOP = `(() => globalThis.__branchloom_bug_capture?.stop() ?? null)()`;

function diagnosticReference(item: BrowserDiagnostic): BugDiagnosticReference {
  const category = item.kind === 'load' ? 'LoadError'
    : (/^(?:Uncaught\s+)?(TypeError|ReferenceError|SyntaxError|RangeError)\b/.exec(item.message)?.[1]
      ?? (/\b(?:net::)?ERR_[A-Z_]+\b/.test(item.message) ? 'NetworkError' : 'ConsoleError')) as BugDiagnosticReference['category'];
  return { kind: item.kind, category, line: item.line && item.line > 0 && item.line <= 1_000_000 ? item.line : null,
    capturedAt: item.capturedAt };
}

type TimedAction = BugReplayAction & { at: number };
type ActiveBugCapture = { projectId: string; tabId: string; url: string; width: number; height: number; startedAt: string; actions: TimedAction[]; ignoredResizes: number };

interface Tab { id: string; view: WebContentsView; requestedUrl: string; restoredUrl: string | null; error: string | null; diagnostics: BrowserDiagnostic[] }

export class StudioBrowser {
  private readonly tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private attachedTabId: string | null = null;
  private visible = false;
  private bounds: BrowserBounds | null = null;
  private readonly browserSession: Session;
  private readonly preventDownload = (event: Electron.Event): void => event.preventDefault();
  private persistTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private activeBugCapture: ActiveBugCapture | null = null;
  private bugCaptureStarting = false;
  private completedBugCapture: BugCaptureDraft | null = null;

  constructor(private readonly window: BrowserWindow, private readonly emit: (state: BrowserState) => void, private readonly onSearchShortcut: () => void = () => undefined, private readonly persistence: BrowserSessionPersistence | null = null) {
    this.browserSession = session.fromPartition(PARTITION);
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
    this.browserSession.on('will-download', this.preventDownload);
    this.window.on('resize', () => this.layout());
    const saved = this.persistence?.load();
    if (saved) {
      for (const url of saved.urls) this.createTab(url);
      this.activeTabId = this.tabs[saved.activeIndex]?.id ?? null;
    }
  }

  state(): BrowserState {
    const tabs = this.tabs.map((tab) => this.tabState(tab));
    const active = tabs.find((tab) => tab.id === this.activeTabId);
    return {
      tabs,
      activeTabId: active?.id ?? null,
      url: active?.url ?? '',
      title: active?.title ?? '',
      loading: active?.loading ?? false,
      canGoBack: active?.canGoBack ?? false,
      canGoForward: active?.canGoForward ?? false,
      error: active?.error ?? null,
      diagnostics: this.tabs.find((tab) => tab.id === this.activeTabId)?.diagnostics.slice().reverse() ?? [],
    };
  }

  newTab(): BrowserState {
    this.cancelBugCapture();
    if (this.tabs.length >= MAX_BROWSER_TABS) throw new Error(`Höchstens ${MAX_BROWSER_TABS} Browser-Tabs sind möglich.`);
    const tab = this.createTab();
    this.activeTabId = tab.id;
    this.layout();
    this.schedulePersist();
    this.publish();
    return this.state();
  }

  selectTab(id: string): BrowserState {
    this.cancelBugCapture();
    if (!this.tabs.some((tab) => tab.id === id)) throw new Error('Browser-Tab nicht gefunden.');
    this.activeTabId = id;
    this.layout();
    this.schedulePersist();
    this.publish();
    return this.state();
  }

  closeTab(id: string): BrowserState {
    this.cancelBugCapture();
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) throw new Error('Browser-Tab nicht gefunden.');
    const tab = this.tabs[index]!;
    if (this.attachedTabId === id) this.detach(tab);
    this.tabs.splice(index, 1);
    if (this.activeTabId === id) this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null;
    this.layout();
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.schedulePersist();
    this.publish();
    return this.state();
  }

  async navigate(address: string): Promise<BrowserState> {
    this.cancelBugCapture();
    const url = normalizeBrowserAddress(address);
    if (!this.activeTab() && this.tabs.length >= MAX_BROWSER_TABS) throw new Error(`Höchstens ${MAX_BROWSER_TABS} Browser-Tabs sind möglich.`);
    const tab = this.activeTab() ?? this.createTab();
    this.activeTabId = tab.id;
    tab.requestedUrl = url;
    tab.restoredUrl = null;
    tab.error = null;
    tab.diagnostics = [];
    this.layout();
    this.schedulePersist();
    this.publish();
    try {
      await tab.view.webContents.loadURL(url);
    } catch (reason) {
      tab.error = reason instanceof Error ? reason.message : String(reason);
      this.publish();
    }
    return this.state();
  }

  back(): BrowserState {
    this.cancelBugCapture();
    const history = this.activeTab()?.view.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
    return this.state();
  }

  forward(): BrowserState {
    this.cancelBugCapture();
    const history = this.activeTab()?.view.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
    return this.state();
  }

  reload(): BrowserState {
    this.cancelBugCapture();
    const tab = this.activeTab();
    if (tab) { tab.diagnostics = []; tab.error = null; tab.view.webContents.reload(); this.publish(); }
    return this.state();
  }

  async captureActive(): Promise<BrowserCaptureResult> {
    const tab = this.activeTab();
    if (!tab || !this.visible || this.attachedTabId !== tab.id || this.window.isDestroyed() || !this.window.isVisible()) throw new Error('Nur ein sichtbarer Browser-Tab kann aufgenommen werden.');
    const url = tab.view.webContents.getURL();
    if (!isSafeBrowserUrl(url)) throw new Error('Der Browser-Tab enthält noch keine geladene Webseite.');
    const image = await tab.view.webContents.capturePage();
    if (this.disposed || !this.visible || this.attachedTabId !== tab.id || this.activeTabId !== tab.id || this.window.isDestroyed() || !this.window.isVisible() || tab.view.webContents.getURL() !== url) throw new Error('Der Browser-Tab hat sich während der Aufnahme geändert.');
    if (image.isEmpty()) throw new Error('Die Webseite lieferte kein Screenshot-Bild.');
    const size = image.getSize();
    const png = image.toPNG();
    if (png.byteLength === 0 || png.byteLength > MAX_CAPTURE_BYTES) throw new Error('Der Screenshot ist leer oder zu groß.');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    return { width: size.width, height: size.height };
  }

  async openActiveExternally(): Promise<void> {
    const tab = this.activeTab();
    if (!tab || !this.visible || this.attachedTabId !== tab.id || this.window.isDestroyed() || !this.window.isVisible()) throw new Error('Nur ein sichtbarer Browser-Tab kann extern geöffnet werden.');
    // The renderer supplies no URL. Validate the currently loaded page again
    // immediately before invoking the operating system's URL handler.
    const current = tab.view.webContents.getURL();
    if (!isSafeBrowserUrl(current)) throw new Error('Der Browser-Tab enthält noch keine gültige Webseite.');
    await shell.openExternal(normalizeBrowserAddress(current));
  }

  setVisible(visible: boolean): BrowserState {
    if (!visible) this.cancelBugCapture();
    this.visible = visible;
    this.layout();
    return this.state();
  }

  setBounds(bounds: BrowserBounds | null): BrowserState {
    this.bounds = clampBrowserBounds(bounds, this.window.getContentSize());
    this.layout();
    return this.state();
  }

  markBugResize(): void {
    const capture = this.activeBugCapture;
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    if (!capture || !bounds || !this.visible || this.activeTabId !== capture.tabId || bounds.width < 320 || bounds.height < 240 || bounds.width > 1920 || bounds.height > 1200) {
      throw new Error('Passe die sichtbare lokale Vorschau während der Aufnahme auf 320–1920 × 240–1200 px an.');
    }
    if (capture.actions.length >= 8) throw new Error('Die Aufnahme enthält bereits zu viele Größenwechsel.');
    capture.actions.push({ kind: 'resize', width: bounds.width, height: bounds.height, at: Date.now() });
  }

  /** Capture trusted clicks on stable IDs in an isolated world of the visible local preview. */
  async startBugCapture(projectId: string): Promise<void> {
    const tab = this.activeTab();
    if (!tab || !this.visible || this.attachedTabId !== tab.id || this.activeBugCapture || this.bugCaptureStarting) throw new Error('Öffne zuerst eine sichtbare lokale Vorschau und beende eine laufende Aufnahme.');
    const url = tab.view.webContents.getURL();
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    if (!isLocalDevUrl(url) || !bounds || bounds.width < 320 || bounds.height < 240 || bounds.width > 1920 || bounds.height > 1200) throw new Error('Die Aufnahme braucht eine lokale Vorschau mit 320–1920 × 240–1200 px.');
    const parsed = new URL(url);
    if (parsed.search || parsed.hash) throw new Error('Entferne Query und Fragment vor der Aufnahme, damit keine Zugangsdaten gespeichert werden.');
    this.bugCaptureStarting = true;
    try {
      await tab.view.webContents.executeJavaScriptInIsolatedWorld(BUG_CAPTURE_WORLD, [{ code: BUG_CAPTURE_START }]);
      if (this.disposed || this.activeTabId !== tab.id || !this.visible || tab.view.webContents.getURL() !== url) {
        if (!tab.view.webContents.isDestroyed()) await tab.view.webContents.executeJavaScriptInIsolatedWorld(BUG_CAPTURE_WORLD, [{ code: BUG_CAPTURE_STOP }]).catch(() => undefined);
        throw new Error('Der Browser-Tab hat sich beim Aufnahmestart geändert.');
      }
      this.completedBugCapture = null;
      this.activeBugCapture = { projectId, tabId: tab.id, url: diagnosticSource(url)!, width: bounds.width, height: bounds.height, startedAt: new Date().toISOString(), actions: [], ignoredResizes: 0 };
    } finally {
      this.bugCaptureStarting = false;
    }
  }

  async stopBugCapture(): Promise<BugCaptureDraft> {
    const capture = this.activeBugCapture;
    const tab = this.activeTab();
    this.activeBugCapture = null;
    if (!capture || !tab || tab.id !== capture.tabId || !this.visible || tab.view.webContents.getURL() !== capture.url) {
      const original = this.tabs.find((item) => item.id === capture?.tabId);
      if (original && !original.view.webContents.isDestroyed()) await original.view.webContents.executeJavaScriptInIsolatedWorld(BUG_CAPTURE_WORLD, [{ code: BUG_CAPTURE_STOP }]).catch(() => undefined);
      throw new Error('Die Aufnahme wurde durch Tab- oder Seitenwechsel unterbrochen. Starte sie erneut.');
    }
    const raw = await tab.view.webContents.executeJavaScriptInIsolatedWorld(BUG_CAPTURE_WORLD, [{ code: BUG_CAPTURE_STOP }]) as { clicks?: unknown; ignoredClicks?: unknown } | null;
    if (!raw || !Array.isArray(raw.clicks)) throw new Error('Die Aufnahmeseite wurde neu geladen; starte die Aufnahme erneut.');
    const clicks: TimedAction[] = raw.clicks.map((item: unknown) => {
      const click = item as { kind?: unknown; target?: { kind?: unknown; value?: unknown }; at?: unknown };
      if (click.kind !== 'click' || !click.target || (click.target.kind !== 'test-id' && click.target.kind !== 'id')
        || typeof click.target.value !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(click.target.value)
        || !Number.isSafeInteger(click.at)) throw new Error('Die Aufnahme enthält einen ungültigen Klick.');
      return { kind: 'click', target: { kind: click.target.kind, value: click.target.value }, at: click.at as number };
    });
    if (!Number.isSafeInteger(raw.ignoredClicks) || (raw.ignoredClicks as number) < 0) throw new Error('Die Aufnahme enthält ungültige Zähler.');
    const actions = [...clicks, ...capture.actions].sort((a, b) => a.at - b.at).map(({ at: _at, ...action }) => action);
    if (!actions.length || actions.length > 5 || (raw.ignoredClicks as number) + capture.ignoredResizes > 0) throw new Error('Die Aufnahme enthält keine oder zu viele eindeutig identifizierbare Schritte. Nutze höchstens fünf Klicks/Größenwechsel mit stabilen Element-IDs.');
    const draft: BugCaptureDraft = { token: randomUUID(), projectId: capture.projectId, url: capture.url, width: capture.width, height: capture.height,
      actions, diagnostics: tab.diagnostics.filter((item) => item.pageUrl === capture.url && item.capturedAt >= capture.startedAt)
        .slice(-5).map(diagnosticReference), ignoredClicks: 0, startedAt: capture.startedAt };
    this.completedBugCapture = draft;
    return structuredClone(draft);
  }

  bugCaptureForToken(token: string): BugCaptureDraft {
    if (!this.completedBugCapture || this.completedBugCapture.token !== token) throw new Error('Diese Aufnahme ist nicht mehr verfügbar.');
    return structuredClone(this.completedBugCapture);
  }

  clearBugCapture(token: string): void {
    if (this.completedBugCapture?.token === token) this.completedBugCapture = null;
  }

  discardBugCapture(): void {
    this.cancelBugCapture();
    this.completedBugCapture = null;
  }

  private cancelBugCapture(): void {
    if (!this.activeBugCapture) return;
    const tab = this.tabs.find((item) => item.id === this.activeBugCapture?.tabId);
    this.activeBugCapture = null;
    if (tab && !tab.view.webContents.isDestroyed()) void tab.view.webContents.executeJavaScriptInIsolatedWorld(BUG_CAPTURE_WORLD, [{ code: BUG_CAPTURE_STOP }]).catch(() => undefined);
  }

  diagnostic(id: string): BrowserDiagnostic {
    const match = this.activeTab()?.diagnostics.find((entry) => entry.id === id);
    if (!match) throw new Error('Der Browserfehler ist nicht mehr verfügbar. Seite neu laden und erneut prüfen.');
    return { ...match };
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelBugCapture();
    this.completedBugCapture = null;
    this.disposed = true;
    this.flushPersist();
    this.browserSession.removeListener('will-download', this.preventDownload);
    const attached = this.tabs.find((tab) => tab.id === this.attachedTabId);
    if (attached) this.detach(attached);
    for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.tabs.length = 0;
    this.activeTabId = null;
  }

  private activeTab(): Tab | undefined { return this.tabs.find((tab) => tab.id === this.activeTabId); }

  private tabState(tab: Tab): BrowserTabState {
    const contents = tab.view.webContents;
    const currentUrl = contents.getURL();
    return {
      id: tab.id,
      url: isSafeBrowserUrl(currentUrl) ? currentUrl : tab.requestedUrl,
      title: contents.getTitle() || '',
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      error: tab.error,
    };
  }

  private createTab(restoredUrl: string | null = null): Tab {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        partition: PARTITION,
      },
    });
    const tab: Tab = { id: randomUUID(), view, requestedUrl: restoredUrl ?? '', restoredUrl, error: null, diagnostics: [] };
    const contents = view.webContents;
    contents.on('before-input-event', (event, input) => {
      if (tab.id === this.activeTabId && input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.onSearchShortcut();
      }
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('context-menu', (_event, params) => {
      const link = params.linkURL;
      if (!this.visible || tab.id !== this.activeTabId || !isSafeBrowserUrl(link)) return;
      Menu.buildFromTemplate([{
        label: 'Link in neuem Tab öffnen',
        enabled: this.tabs.length < MAX_BROWSER_TABS,
        click: () => { void this.openLinkInNewTab(link); },
      }]).popup({ window: this.window });
    });
    contents.on('will-navigate', (event) => { if (!isSafeBrowserUrl(event.url)) event.preventDefault(); });
    contents.on('will-redirect', (event) => { if (!isSafeBrowserUrl(event.url)) event.preventDefault(); });
    contents.on('did-navigate', () => { if (this.activeBugCapture?.tabId === tab.id) this.cancelBugCapture(); tab.error = null; tab.diagnostics = []; this.schedulePersist(); this.publish(); });
    contents.on('did-navigate-in-page', () => { if (this.activeBugCapture?.tabId === tab.id) this.cancelBugCapture(); this.schedulePersist(); this.publish(); });
    contents.on('page-title-updated', () => this.publish());
    contents.on('did-start-loading', () => this.publish());
    contents.on('did-stop-loading', () => this.publish());
    contents.on('console-message', (event) => {
      if (event.level !== 'error') return;
      this.addDiagnostic(tab, 'console', event.message, event.sourceId, event.lineNumber);
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) { tab.error = description; this.addDiagnostic(tab, 'load', `${description} (${code})`, url, null, url); this.publish(); }
    });
    this.tabs.push(tab);
    return tab;
  }

  private addDiagnostic(tab: Tab, kind: BrowserDiagnostic['kind'], rawMessage: string, sourceUrl: string, line: number | null, failedUrl?: string): void {
    const pageUrl = failedUrl ?? (tab.view.webContents.getURL() || tab.requestedUrl);
    if (!isLocalDevUrl(pageUrl)) return;
    const message = rawMessage.trim().slice(0, 2_000);
    if (!message) return;
    const source = diagnosticSource(sourceUrl);
    const sourceLine = Number.isSafeInteger(line) && line !== null && line > 0 ? line : null;
    if (tab.diagnostics.some((entry) => entry.kind === kind && entry.message === message && entry.pageUrl === diagnosticSource(pageUrl) && entry.sourceUrl === source && entry.line === sourceLine)) return;
    tab.diagnostics.push({ id: randomUUID(), kind, message, pageUrl: diagnosticSource(pageUrl)!, sourceUrl: source, line: sourceLine, capturedAt: new Date().toISOString() });
    if (tab.diagnostics.length > 20) tab.diagnostics.shift();
    this.publish();
  }

  private detach(tab: Tab): void {
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (this.attachedTabId === tab.id) this.attachedTabId = null;
  }

  private async openLinkInNewTab(address: string): Promise<void> {
    // Validate again at click time; a menu can stay open while tabs or pages change.
    const url = normalizeBrowserAddress(address);
    if (this.tabs.length >= MAX_BROWSER_TABS || this.disposed) return;
    this.newTab();
    await this.navigate(url);
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
    const active = this.activeTab();
    const bounds = clampBrowserBounds(this.bounds, this.window.getContentSize());
    const attached = this.tabs.find((tab) => tab.id === this.attachedTabId);
    if (attached && (!this.visible || !bounds || attached.id !== active?.id)) this.detach(attached);
    if (this.visible && bounds && active) {
      active.view.setBounds(bounds);
      if (this.attachedTabId !== active.id) {
        this.window.contentView.addChildView(active.view);
        this.attachedTabId = active.id;
      }
      if (active.restoredUrl) {
        const url = active.restoredUrl;
        active.restoredUrl = null;
        void active.view.webContents.loadURL(url).catch((reason: unknown) => {
          active.error = reason instanceof Error ? reason.message : String(reason);
          this.publish();
        });
      }
    }
  }

  private schedulePersist(): void {
    if (!this.persistence || this.disposed) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersist(), 250);
    this.persistTimer.unref();
  }

  private flushPersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.persistence) return;
    const urls = this.tabs.map((tab) => {
      const url = this.tabState(tab).url;
      return url && isSafeBrowserUrl(url) ? url : null;
    });
    const activeIndex = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    try { this.persistence.save({ urls, activeIndex }); }
    catch { console.error('[Branchloom] Browser-Sitzung konnte nicht gespeichert werden.'); }
  }

  private publish(): void { this.emit(this.state()); }
}
