import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { clampBrowserBounds, diagnosticSource, isLocalDevUrl, isSafeBrowserUrl, normalizeBrowserAddress } from '../../src/main/browser-policy';
import { BrowserSessionPersistence } from '../../src/main/browser-persistence';

const mocked = vi.hoisted(() => ({
  views: [] as unknown[],
  permissionRequestHandler: null as null | ((_contents: unknown, permission: string, callback: (allowed: boolean) => void) => void),
  permissionCheckHandler: null as null | (() => boolean),
  downloadHandler: null as null | ((event: { preventDefault(): void }) => void),
  removedDownloadHandler: null as null | ((event: { preventDefault(): void }) => void),
  menus: [] as unknown[],
  clipboardWrites: [] as unknown[],
  externalOpens: [] as string[],
  captureClicks: [] as Array<{ kind: 'click'; target: { kind: 'id' | 'test-id'; value: string }; at: number }>,
  captureIgnored: 0,
  captureStops: 0,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeContents extends EventEmitter {
    url = '';
    title = '';
    destroyed = false;
    entries: string[] = [];
    index = -1;
    windowOpenHandler: unknown;
    navigationHistory = {
      canGoBack: () => this.index > 0,
      canGoForward: () => this.index < this.entries.length - 1,
      goBack: () => { if (this.index > 0) { this.url = this.entries[--this.index]!; this.emit('did-navigate'); } },
      goForward: () => { if (this.index < this.entries.length - 1) { this.url = this.entries[++this.index]!; this.emit('did-navigate'); } },
    };
    getURL() { return this.url; }
    getTitle() { return this.title; }
    isLoading() { return false; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    reload() { this.emit('did-start-loading'); this.emit('did-stop-loading'); }
    setWindowOpenHandler(handler: unknown) { this.windowOpenHandler = handler; }
    async loadURL(url: string) {
      this.emit('did-start-loading');
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push(url);
      this.index = this.entries.length - 1;
      this.url = url;
      this.title = 'Example';
      this.emit('did-navigate');
      this.emit('did-stop-loading');
    }
    async capturePage() { return { isEmpty: () => false, getSize: () => ({ width: 640, height: 360 }), toPNG: () => Buffer.from([137, 80, 78, 71]) }; }
    async executeJavaScriptInIsolatedWorld(_worldId: number, scripts: Array<{ code: string }>) {
      if (scripts[0]?.code.includes('BUG_CAPTURE_UNUSED_MARKER')) throw new Error('Unexpected script');
      if (scripts[0]?.code.includes('__branchloom_bug_capture?.stop()')) { mocked.captureStops++; return { clicks: mocked.captureClicks, ignoredClicks: mocked.captureIgnored }; }
      return true;
    }
  }
  class FakeView {
    webContents = new FakeContents();
    bounds: unknown = null;
    constructor(public options: unknown) { mocked.views.push(this); }
    setBounds(bounds: unknown) { this.bounds = bounds; }
  }
  return {
    WebContentsView: FakeView,
    Menu: { buildFromTemplate: (template: unknown) => {
      mocked.menus.push(template);
      return { popup: vi.fn() };
    } },
    ClipboardItem: class { constructor(public items: Record<string, unknown>) {} },
    clipboard: { write: async (items: unknown[]) => { mocked.clipboardWrites.push(items); } },
    shell: { openExternal: async (url: string) => { mocked.externalOpens.push(url); } },
    session: { fromPartition: () => ({
      setPermissionRequestHandler: (handler: typeof mocked.permissionRequestHandler) => { mocked.permissionRequestHandler = handler; },
      setPermissionCheckHandler: (handler: typeof mocked.permissionCheckHandler) => { mocked.permissionCheckHandler = handler; },
      on: (_event: string, handler: typeof mocked.downloadHandler) => { mocked.downloadHandler = handler; },
      removeListener: (_event: string, handler: typeof mocked.downloadHandler) => { mocked.removedDownloadHandler = handler; },
    }) },
  };
});

import { StudioBrowser } from '../../src/main/browser';

function fakeWindow() {
  const emitter = new EventEmitter();
  const attached: unknown[] = [];
  return Object.assign(emitter, {
    contentView: {
      addChildView(view: unknown) { attached.push(view); },
      removeChildView(view: unknown) { const index = attached.indexOf(view); if (index >= 0) attached.splice(index, 1); },
    },
    attached,
    getContentSize: () => [900, 700],
    isDestroyed: () => false,
    isVisible: () => true,
  });
}

describe('browser URL and bounds policy', () => {
  it('accepts only web URLs without embedded credentials', () => {
    expect(normalizeBrowserAddress('example.com/path')).toBe('https://example.com/path');
    expect(normalizeBrowserAddress('http://localhost:3000')).toBe('http://localhost:3000/');
    for (const address of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,x', 'https://user:pass@example.com', 'example.com/path with space', '']) {
      expect(() => normalizeBrowserAddress(address)).toThrow();
    }
    expect(isSafeBrowserUrl('https://example.com')).toBe(true);
    expect(isSafeBrowserUrl('file:///etc/passwd')).toBe(false);
  });

  it('clamps web view bounds inside the app window', () => {
    expect(clampBrowserBounds({ x: 800, y: 600, width: 500, height: 500 }, [900, 700])).toEqual({ x: 800, y: 600, width: 100, height: 100 });
    expect(clampBrowserBounds({ x: -200, y: -20, width: 600, height: 200 }, [900, 700])).toEqual({ x: 0, y: 0, width: 400, height: 180 });
    expect(clampBrowserBounds({ x: 0, y: 0, width: 0, height: 0 }, [900, 700])).toBeNull();
    expect(() => clampBrowserBounds({ x: Number.NaN, y: 0, width: 100, height: 100 }, [900, 700])).toThrow();
  });

  it('limits diagnostic capture to loopback previews and removes URL secrets', () => {
    expect(isLocalDevUrl('http://localhost:5173/app')).toBe(true);
    expect(isLocalDevUrl('http://127.0.0.1:3000/')).toBe(true);
    expect(isLocalDevUrl('http://[::1]:3000/')).toBe(true);
    expect(isLocalDevUrl('https://localhost.evil.example/')).toBe(false);
    expect(isLocalDevUrl('https://example.com/')).toBe(false);
    expect(diagnosticSource('http://localhost:5173/app?token=secret#state')).toBe('http://localhost:5173/app');
    expect(diagnosticSource('file:///private')).toBeNull();
  });
});

describe('isolated embedded browser', () => {
  it('captures only bounded stable-element clicks and an explicitly marked local viewport change', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    browser.newTab();
    await browser.navigate('http://127.0.0.1:5173/settings');
    browser.setVisible(true);
    browser.setBounds({ x: 0, y: 0, width: 600, height: 500 });
    await browser.startBugCapture('project-synthetic');
    mocked.captureClicks = [{ kind: 'click', target: { kind: 'id', value: 'menu' }, at: Date.now() - 100 }];
    browser.setBounds({ x: 0, y: 0, width: 390, height: 400 });
    browser.markBugResize();
    const draft = await browser.stopBugCapture();
    expect(draft).toMatchObject({ projectId: 'project-synthetic', url: 'http://127.0.0.1:5173/settings',
      width: 600, height: 500, actions: [{ kind: 'click', target: { kind: 'id', value: 'menu' } }, { kind: 'resize', width: 390, height: 400 }] });
    expect(browser.bugCaptureForToken(draft.token).actions).toHaveLength(2);
    browser.clearBugCapture(draft.token);
    expect(() => browser.bugCaptureForToken(draft.token)).toThrow('nicht mehr verfügbar');
    browser.dispose(); mocked.captureClicks = []; mocked.captureIgnored = 0;
  });

  it('rejects external, query-bearing, and ambiguous recordings', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    browser.newTab(); browser.setVisible(true); browser.setBounds({ x: 0, y: 0, width: 600, height: 500 });
    await browser.navigate('https://example.com/');
    await expect(browser.startBugCapture('project-synthetic')).rejects.toThrow('lokale Vorschau');
    await browser.navigate('http://127.0.0.1:5173/settings?token=private');
    await expect(browser.startBugCapture('project-synthetic')).rejects.toThrow('Query');
    await browser.navigate('http://127.0.0.1:5173/settings');
    await browser.startBugCapture('project-synthetic');
    mocked.captureClicks = [{ kind: 'click', target: { kind: 'id', value: 'menu' }, at: Date.now() }];
    mocked.captureIgnored = 1;
    await expect(browser.stopBugCapture()).rejects.toThrow('eindeutig identifizierbare');
    browser.dispose(); mocked.captureClicks = []; mocked.captureIgnored = 0;
  });
  it('removes the capture listener when the visible tab changes during start or before stop', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    browser.newTab();
    await browser.navigate('http://127.0.0.1:5173/settings');
    browser.setVisible(true); browser.setBounds({ x: 0, y: 0, width: 600, height: 500 });
    const contents = (mocked.views.at(-1) as { webContents: { url: string; executeJavaScriptInIsolatedWorld: (world: number, scripts: Array<{ code: string }>) => Promise<unknown> } }).webContents;
    const original = contents.executeJavaScriptInIsolatedWorld.bind(contents);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    contents.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
      if (scripts[0]?.code.includes("const key = '__branchloom_bug_capture'")) await pending;
      return original(world, scripts);
    };
    const before = mocked.captureStops;
    const starting = browser.startBugCapture('project-synthetic');
    browser.setVisible(false);
    release();
    await expect(starting).rejects.toThrow('beim Aufnahmestart geändert');
    expect(mocked.captureStops).toBe(before + 1);
    browser.setVisible(true);
    await browser.startBugCapture('project-synthetic');
    contents.url = 'http://127.0.0.1:5173/elsewhere';
    await expect(browser.stopBugCapture()).rejects.toThrow('Seitenwechsel');
    expect(mocked.captureStops).toBe(before + 2);
    browser.dispose();
  });
  it('captures bounded real console errors from local previews only, with source and tab isolation', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    await browser.navigate('http://localhost:5173/page?token=secret');
    const local = mocked.views.at(-1) as { webContents: EventEmitter };
    local.webContents.emit('console-message', { level: 'warning', message: 'ignore', sourceId: 'http://localhost:5173/a.ts', lineNumber: 1 });
    expect(browser.state().diagnostics).toHaveLength(0);
    local.webContents.emit('console-message', { level: 'error', message: 'TypeError: broken', sourceId: 'http://localhost:5173/app.ts?key=secret', lineNumber: 42 });
    const issue = browser.state().diagnostics[0]!;
    expect(issue).toMatchObject({ kind: 'console', message: 'TypeError: broken', pageUrl: 'http://localhost:5173/page', sourceUrl: 'http://localhost:5173/app.ts', line: 42 });
    expect(browser.diagnostic(issue.id)).toEqual(issue);
    local.webContents.emit('console-message', { level: 'error', message: 'TypeError: broken', sourceId: 'http://localhost:5173/app.ts?key=other', lineNumber: 42 });
    expect(browser.state().diagnostics).toHaveLength(1);
    browser.newTab();
    expect(browser.state().diagnostics).toHaveLength(0);
    expect(() => browser.diagnostic(issue.id)).toThrow('nicht mehr verfügbar');
    await browser.navigate('https://external.example/');
    const external = mocked.views.at(-1) as { webContents: EventEmitter };
    external.webContents.emit('console-message', { level: 'error', message: 'Do not capture', sourceId: 'https://external.example/x.js', lineNumber: 2 });
    expect(browser.state().diagnostics).toHaveLength(0);
    browser.closeTab(browser.state().tabs[0]!.id);
    expect(() => browser.diagnostic(issue.id)).toThrow('nicht mehr verfügbar');
    browser.dispose();
  });

  it('records a local main-frame load failure and ignores cancelled navigation', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    await browser.navigate('http://127.0.0.1:5173/');
    const view = mocked.views.at(-1) as { webContents: EventEmitter };
    view.webContents.emit('did-fail-load', {}, -3, 'Cancelled', 'http://127.0.0.1:5173/', true);
    expect(browser.state().diagnostics).toHaveLength(0);
    view.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:5173/', true);
    expect(browser.state().diagnostics[0]).toMatchObject({ kind: 'load', message: 'ERR_CONNECTION_REFUSED (-102)', pageUrl: 'http://127.0.0.1:5173/' });
    browser.dispose();
  });
  it('navigates, attaches only while visible, denies permissions and blocks unsafe redirects', async () => {
    const window = fakeWindow();
    const events: string[] = [];
    const search = vi.fn();
    const browser = new StudioBrowser(window as unknown as BrowserWindow, (state) => events.push(state.url), search);
    browser.setBounds({ x: 100, y: 100, width: 600, height: 400 });
    browser.setVisible(true);
    expect(window.attached).toHaveLength(0);
    await browser.navigate('example.com');
    expect(browser.state().url).toBe('https://example.com/');
    expect(window.attached).toHaveLength(1);
    expect(events).toContain('https://example.com/');
    const view = mocked.views.at(-1) as { options: { webPreferences: Record<string, unknown> }; webContents: EventEmitter & { destroyed: boolean; windowOpenHandler: () => { action: string } } };
    expect(view.options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
    expect(view.windowOpenHandler).toBeUndefined();
    expect(view.webContents.windowOpenHandler().action).toBe('deny');
    let allowed: boolean | null = null;
    mocked.permissionRequestHandler?.(view.webContents, 'media', (decision) => { allowed = decision; });
    expect(allowed).toBe(false);
    expect(mocked.permissionCheckHandler?.()).toBe(false);
    const download = { preventDefault: vi.fn() };
    mocked.downloadHandler?.(download);
    expect(download.preventDefault).toHaveBeenCalledOnce();
    const unsafe = { url: 'file:///C:/secret', preventDefault: vi.fn() };
    view.webContents.emit('will-redirect', unsafe);
    expect(unsafe.preventDefault).toHaveBeenCalledOnce();
    const shortcut = { preventDefault: vi.fn() };
    view.webContents.emit('before-input-event', shortcut, { type: 'keyDown', control: true, meta: false, key: 'k' });
    expect(shortcut.preventDefault).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledOnce();
    browser.setVisible(false);
    expect(window.attached).toHaveLength(0);
    browser.dispose();
    expect(view.webContents.destroyed).toBe(true);
    expect(mocked.removedDownloadHandler).toBe(mocked.downloadHandler);
  });

  it('keeps independent history per tab and closes only the selected tab', async () => {
    const window = fakeWindow();
    const browser = new StudioBrowser(window as unknown as BrowserWindow, () => undefined);
    browser.setBounds({ x: 10, y: 10, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('first.example');
    const firstId = browser.state().activeTabId!;
    await browser.navigate('second.example');
    expect(browser.state().canGoBack).toBe(true);
    const secondId = browser.newTab().activeTabId!;
    expect(secondId).not.toBe(firstId);
    expect(browser.state().tabs).toHaveLength(2);
    await browser.navigate('third.example');
    expect(browser.state().canGoBack).toBe(false);
    expect(window.attached).toHaveLength(1);
    browser.selectTab(firstId);
    expect(browser.state().url).toBe('https://second.example/');
    expect(browser.back().url).toBe('https://first.example/');
    expect(browser.forward().url).toBe('https://second.example/');
    browser.selectTab(secondId);
    expect(browser.state().url).toBe('https://third.example/');
    expect(browser.state().canGoBack).toBe(false);
    browser.closeTab(firstId);
    expect(browser.state().tabs).toHaveLength(1);
    expect(browser.state().activeTabId).toBe(secondId);
    browser.closeTab(secondId);
    expect(browser.state().tabs).toHaveLength(0);
    expect(browser.state().activeTabId).toBeNull();
    expect(window.attached).toHaveLength(0);
    expect(() => browser.selectTab('missing')).toThrow('nicht gefunden');
    browser.dispose();
  });

  it('restores tabs and active URL after restart without loading hidden pages', async () => {
    const path = mkdtempSync(join(tmpdir(), 'studio-browser-restart-'));
    try {
      const persistence = new BrowserSessionPersistence(path);
      const first = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined, () => undefined, persistence);
      await first.navigate('https://first.test/path');
      const firstId = first.state().activeTabId!;
      first.newTab();
      first.selectTab(firstId);
      first.dispose();
      first.dispose();
      expect(persistence.load()).toEqual({ urls: ['https://first.test/path', null], activeIndex: 0 });

      const window = fakeWindow();
      const second = new StudioBrowser(window as unknown as BrowserWindow, () => undefined, () => undefined, persistence);
      expect(second.state().tabs).toHaveLength(2);
      expect(second.state().url).toBe('https://first.test/path');
      const restoredViews = mocked.views.slice(-2) as Array<{ webContents: { entries: string[] } }>;
      expect(restoredViews.every((view) => view.webContents.entries.length === 0)).toBe(true);
      second.setBounds({ x: 0, y: 0, width: 700, height: 500 });
      second.setVisible(true);
      expect(restoredViews[0]?.webContents.entries).toEqual(['https://first.test/path']);
      expect(restoredViews[1]?.webContents.entries).toEqual([]);
      second.dispose();
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('opens a safe page link only after the explicit context-menu action', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    browser.setBounds({ x: 0, y: 0, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('https://source.test/');
    const sourceId = browser.state().activeTabId;
    const view = mocked.views.at(-1) as { webContents: EventEmitter & { windowOpenHandler: () => { action: string } } };
    const menuCount = mocked.menus.length;
    view.webContents.emit('context-menu', {}, { linkURL: 'file:///C:/private.txt' });
    view.webContents.emit('context-menu', {}, { linkURL: '' });
    expect(mocked.menus).toHaveLength(menuCount);
    view.webContents.emit('context-menu', {}, { linkURL: 'https://destination.test/page' });
    expect(mocked.menus).toHaveLength(menuCount + 1);
    expect(browser.state().tabs).toHaveLength(1);
    const [item] = mocked.menus.at(-1) as Array<{ label: string; enabled: boolean; click: () => void }>;
    expect(item?.label).toBe('Link in neuem Tab öffnen');
    expect(item?.enabled).toBe(true);
    item?.click();
    await Promise.resolve();
    expect(browser.state().tabs).toHaveLength(2);
    expect(browser.state().activeTabId).not.toBe(sourceId);
    expect(browser.state().url).toBe('https://destination.test/page');
    expect(view.webContents.windowOpenHandler().action).toBe('deny');
    view.webContents.emit('context-menu', {}, { linkURL: 'https://other.test/' });
    expect(mocked.menus).toHaveLength(menuCount + 1);
    browser.dispose();
  });

  it('copies only the visible active tab after an explicit screenshot request', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    await expect(browser.captureActive()).rejects.toThrow('sichtbarer Browser-Tab');
    browser.setBounds({ x: 0, y: 0, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('https://capture.test/page');
    const before = mocked.clipboardWrites.length;
    await expect(browser.captureActive()).resolves.toEqual({ width: 640, height: 360 });
    expect(mocked.clipboardWrites).toHaveLength(before + 1);
    const [item] = mocked.clipboardWrites.at(-1) as Array<{ items: Record<string, unknown> }>;
    expect(item?.items['image/png']).toBeInstanceOf(Blob);
    browser.setVisible(false);
    await expect(browser.captureActive()).rejects.toThrow('sichtbarer Browser-Tab');
    expect(mocked.clipboardWrites).toHaveLength(before + 1);
    browser.dispose();
  });

  it('does not copy if the user changes tabs while capture is pending', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    browser.setBounds({ x: 0, y: 0, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('https://capture.test/');
    let complete!: (image: { isEmpty(): boolean; getSize(): { width: number; height: number }; toPNG(): Buffer }) => void;
    const view = mocked.views.at(-1) as { webContents: { capturePage: () => Promise<unknown> } };
    view.webContents.capturePage = () => new Promise((resolve) => { complete = resolve; });
    const pending = browser.captureActive();
    browser.newTab();
    const before = mocked.clipboardWrites.length;
    complete({ isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }), toPNG: () => Buffer.from([1]) });
    await expect(pending).rejects.toThrow('während der Aufnahme geändert');
    expect(mocked.clipboardWrites).toHaveLength(before);
    browser.dispose();
  });

  it('opens only the loaded active HTTP(S) page in the default browser on request', async () => {
    const browser = new StudioBrowser(fakeWindow() as unknown as BrowserWindow, () => undefined);
    const before = mocked.externalOpens.length;
    await expect(browser.openActiveExternally()).rejects.toThrow('sichtbarer Browser-Tab');
    browser.setBounds({ x: 0, y: 0, width: 700, height: 500 });
    browser.setVisible(true);
    await browser.navigate('https://example.test/mail');
    await browser.openActiveExternally();
    expect(mocked.externalOpens.slice(before)).toEqual(['https://example.test/mail']);
    const view = mocked.views.at(-1) as { webContents: { url: string; windowOpenHandler: () => { action: string } } };
    view.webContents.url = 'file:///C:/private.txt';
    await expect(browser.openActiveExternally()).rejects.toThrow('gültige Webseite');
    expect(mocked.externalOpens).toHaveLength(before + 1);
    view.webContents.url = 'javascript:alert(1)';
    await expect(browser.openActiveExternally()).rejects.toThrow('gültige Webseite');
    view.webContents.url = `https://example.test/${'x'.repeat(2100)}`;
    await expect(browser.openActiveExternally()).rejects.toThrow('gültige Webadresse');
    expect(view.webContents.windowOpenHandler().action).toBe('deny');
    browser.setVisible(false);
    await expect(browser.openActiveExternally()).rejects.toThrow('sichtbarer Browser-Tab');
    expect(mocked.externalOpens).toHaveLength(before + 1);
    browser.dispose();
  });
});
