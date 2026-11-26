import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const fake = vi.hoisted(() => ({ windows: [] as Array<{ options: { show: boolean; width: number; height: number; useContentSize: boolean; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }; destroyed: boolean; webContents: unknown }>, mode: 'clean' as 'clean' | 'console' | 'remote' | 'load-error' | 'capture-error' | 'capture-large' | 'capture-empty' | 'slow' | 'clamped' | 'page-issues' | 'page-partial' | 'page-error', releases: [] as Array<() => void> }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    url = '';
    permissionRequestHandler: unknown;
    permissionCheckHandler: unknown;
    requestHandler: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | null = null;
    session = {
      setPermissionRequestHandler: (handler: unknown) => { this.permissionRequestHandler = handler; },
      setPermissionCheckHandler: (handler: unknown) => { this.permissionCheckHandler = handler; },
      on: (_event: string, _handler: unknown) => undefined,
      webRequest: { onBeforeRequest: (_filter: unknown, handler: typeof this.requestHandler) => { this.requestHandler = handler; } },
    };
    setWindowOpenHandler(_handler: unknown) { /* observed through the page not opening */ }
    getURL() { return this.url; }
    async loadURL(url: string) {
      this.url = url;
      if (fake.mode === 'slow') return new Promise<void>((resolve) => { fake.releases.push(resolve); });
      if (fake.mode === 'load-error' || url.includes('/broken')) throw new Error(`ERR_CONNECTION_REFUSED: ${url}`);
      if (fake.mode === 'console' || url.includes('/console')) this.emit('console-message', { level: 'error', message: 'Synthetic TypeError', sourceId: `${new URL(url).origin}/app.js?token=private`, lineNumber: 7 });
      if (fake.mode === 'remote') this.requestHandler?.({ url: 'https://example.invalid/asset.js?token=private' }, () => undefined);
    }
    async executeJavaScript() {
      if (fake.mode === 'page-error') throw new Error('Synthetic page evaluation failed');
      return { hasTitle: fake.mode !== 'page-issues', scannedImages: fake.mode === 'page-partial' ? 200 : 5, imagesWithoutAlt: fake.mode === 'page-issues' ? 2 : 0,
        imagesTruncated: fake.mode === 'page-partial', clientWidth: 390, overflowPixels: fake.mode === 'page-issues' ? 24 : 0 };
    }
    async capturePage() {
      if (fake.mode === 'capture-error') throw new Error('Synthetic capture failure');
      const bytes = fake.mode === 'capture-large' ? Buffer.alloc(1_000_001) : fake.mode === 'capture-empty' ? Buffer.alloc(0) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4bPgAAAAASUVORK5CYII=', 'base64');
      const image = { getSize: () => ({ width: 1280, height: 800 }), resize: (_size: { width: number; height: number }) => image, toPNG: () => bytes };
      return image;
    }
  }
  return { BrowserWindow: class {
    destroyed = false;
    webContents = new Contents();
    constructor(public options: { show: boolean; width: number; height: number; useContentSize: boolean; webPreferences: { partition: string; sandbox: boolean; nodeIntegration: boolean; webSecurity: boolean } }) { fake.windows.push(this); }
    setContentSize(width: number, height: number) { this.options.width = width; this.options.height = fake.mode === 'clamped' ? 684 : height; }
    getContentSize() { return [this.options.width, this.options.height]; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  } };
});

import { StudioStore } from '../../src/main/store';
import { cardQaReports, cardQaScreenshot, listProjectQaCaptures, normalizeCardQaUrl, runCardQa, runCardQaBatch } from '../../src/main/card-qa';

const roots: string[] = [];
afterEach(() => { for (const release of fake.releases.splice(0)) release(); fake.mode = 'clean'; fake.windows.length = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-qa-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic QA', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Check page' });
  return { file, store, project, card };
}

describe('explicit local card QA', () => {
  it('indexes only saved screenshot evidence from the requested project', async () => {
    const { store, project, card } = fixture();
    const otherPath = join(project.path, 'other'); mkdirSync(otherPath);
    const otherProject = store.createProject({ name: 'Other', path: otherPath });
    const otherCard = store.createCard({ projectId: otherProject.id, columnId: store.snapshot(otherProject.id).columns[0]!.id, title: 'Other view' });
    const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/account?token=private', viewport: 'desktop' });
    await runCardQa(store, { cardId: otherCard.id, url: 'http://127.0.0.1:5173/other', viewport: 'mobile' });
    fake.mode = 'capture-error';
    await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/no-image', viewport: 'tablet' });
    const index = listProjectQaCaptures(store, project.id);
    expect(index).toMatchObject({ moreAvailable: false, items: [{ id: report.id, cardId: card.id, status: 'passed', viewportWidth: 1280, viewportHeight: 800 }] });
    expect(index.items).toHaveLength(1);
    expect(JSON.stringify(index)).not.toContain('token=private');
    expect(cardQaScreenshot(store, { cardId: card.id, reportId: index.items[0]!.id })).toMatch(/^data:image\/png;base64,/);
    expect(() => listProjectQaCaptures(store, 'missing-project')).toThrow();
    store.close();
  });

  it('persists actual checkout HEAD evidence beside a QA screenshot without claiming the page came from Git', async () => {
    const { store, file, project, card } = fixture();
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: project.path, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
      return result.stdout.trim();
    };
    git('init', '-q');
    writeFileSync(join(project.path, 'tracked.txt'), 'synthetic\n');
    git('add', 'tracked.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic');
    const head = git('rev-parse', 'HEAD');
    const clean = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/', viewport: 'desktop' });
    expect(clean).toMatchObject({ screenshotAvailable: true, gitEvidence: { scope: 'project', state: 'clean', startHead: head, endHead: head } });
    writeFileSync(join(project.path, 'tracked.txt'), 'changed after commit\n');
    const dirty = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/', viewport: 'mobile' });
    expect(dirty.gitEvidence).toMatchObject({ state: 'dirty', dirtyAtStart: true, dirtyAtEnd: true });
    git('add', 'tracked.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'second');
    fake.mode = 'slow';
    const changing = runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/', viewport: 'tablet' });
    await vi.waitFor(() => expect(fake.releases).toHaveLength(1));
    writeFileSync(join(project.path, 'tracked.txt'), 'third\n');
    git('add', 'tracked.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'third');
    fake.mode = 'clean';
    fake.releases.shift()?.();
    expect((await changing).gitEvidence).toMatchObject({ state: 'changed', startHead: git('rev-parse', 'HEAD~1'), endHead: git('rev-parse', 'HEAD') });
    store.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id).map((item) => item.gitEvidence?.state)).toEqual(['changed', 'dirty', 'clean']);
    reopened.close();
  });

  it('stores bounded page observations independently from console/load status and survives restart', async () => {
    const { store, file, card } = fixture();
    fake.mode = 'page-issues';
    const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/issue?token=private', viewport: 'mobile' });
    expect(report).toMatchObject({ status: 'passed', pageCheck: 'complete', pageObservations: [
      { kind: 'missing-title' }, { kind: 'missing-image-alt', count: 2, scanned: 5 }, { kind: 'horizontal-overflow', pixels: 24, clientWidth: 390 },
    ] });
    expect(JSON.stringify(report)).not.toContain('token=private');
    store.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id)).toEqual([report]);
    reopened.close();
  });

  it('marks a truncated image scan partial and an evaluation failure unavailable without inventing issues', async () => {
    const { store, card } = fixture();
    fake.mode = 'page-partial';
    const partial = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/partial', viewport: 'desktop' });
    expect(partial).toMatchObject({ pageCheck: 'partial', pageObservations: [] });
    fake.mode = 'page-error';
    const failedCheck = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/no-dom', viewport: 'desktop' });
    expect(failedCheck).toMatchObject({ status: 'passed', pageCheck: 'unavailable', pageObservations: [] });
    expect(failedCheck.screenshotAvailable).toBe(true);
    fake.mode = 'load-error';
    const loadError = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/broken', viewport: 'desktop' });
    expect(loadError).toMatchObject({ status: 'error', pageCheck: 'not-run', pageObservations: [] });
    store.close();
  });

  it('checks up to five validated local routes in order and keeps each outcome', async () => {
    const { store, card } = fixture();
    const urls = ['http://127.0.0.1:5173/first', 'http://127.0.0.1:5173/console', 'http://127.0.0.1:5173/broken', 'http://127.0.0.1:5173/last'];
    const result = await runCardQaBatch(store, { cardId: card.id, urls, viewport: 'mobile' });
    expect(result).toMatchObject({ requested: 4, error: null });
    expect(result.reports.map((item) => item.status)).toEqual(['passed', 'failed', 'error', 'passed']);
    expect(result.reports.map((item) => item.requestedUrl)).toEqual(urls);
    expect(result.reports.every((item) => item.viewportWidth === 390 && item.viewportHeight === 844)).toBe(true);
    expect(new Set(fake.windows.map((item) => item.options.webPreferences.partition)).size).toBe(4);
    expect(fake.windows.every((item) => item.destroyed)).toBe(true);
    expect(cardQaReports(store, card.id).map((item) => item.id)).toEqual(result.reports.map((item) => item.id).reverse());
    expect(store.snapshot(card.projectId).sessions).toEqual([]);
    store.close();
  });

  it('validates the entire route list before opening a browser and holds a reservation through the batch', async () => {
    const { store, project, card } = fixture();
    const other = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Other' });
    const third = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Third' });
    const base = 'http://127.0.0.1:5173/';
    for (const urls of [[], Array.from({ length: 6 }, (_, index) => `${base}${index}`), [base, 'https://example.invalid/'], [base, base]]) {
      await expect(runCardQaBatch(store, { cardId: card.id, urls, viewport: 'desktop' })).rejects.toThrow();
    }
    await expect(runCardQaBatch(store, { cardId: card.id, urls: [base], viewport: 'wide' as 'desktop' })).rejects.toThrow('Prüfgröße');
    expect(fake.windows).toHaveLength(0);
    expect(cardQaReports(store, card.id)).toEqual([]);
    fake.mode = 'slow';
    const batch = runCardQaBatch(store, { cardId: card.id, urls: [`${base}one`, `${base}two`], viewport: 'desktop' });
    await vi.waitFor(() => expect(fake.releases).toHaveLength(1));
    await expect(runCardQa(store, { cardId: card.id, url: base, viewport: 'desktop' })).rejects.toThrow('bereits eine QA-Prüfung');
    const otherRun = runCardQa(store, { cardId: other.id, url: base, viewport: 'desktop' });
    await vi.waitFor(() => expect(fake.releases).toHaveLength(2));
    await expect(runCardQaBatch(store, { cardId: third.id, urls: [base], viewport: 'desktop' })).rejects.toThrow('zwei lokale QA-Prüfungen');
    fake.mode = 'clean';
    for (const release of fake.releases.splice(0)) release();
    expect((await batch).reports).toHaveLength(2);
    await otherRun;
    expect((await runCardQa(store, { cardId: third.id, url: base, viewport: 'desktop' })).status).toBe('passed');
    store.close();
  });

  it('keeps the first report but skips remaining routes if the card is archived during a batch', async () => {
    const { store, card } = fixture();
    fake.mode = 'slow';
    const batch = runCardQaBatch(store, { cardId: card.id, urls: ['http://127.0.0.1:5173/first', 'http://127.0.0.1:5173/second'], viewport: 'desktop' });
    await vi.waitFor(() => expect(fake.releases).toHaveLength(1));
    store.setCardArchived({ id: card.id, archived: true });
    fake.mode = 'clean';
    fake.releases.shift()?.();
    const result = await batch;
    expect(result).toMatchObject({ requested: 2, error: expect.stringContaining('archiviert') });
    expect(result.reports).toHaveLength(1);
    expect(fake.windows).toHaveLength(1);
    expect(cardQaReports(store, card.id).map((item) => item.id)).toEqual([result.reports[0]!.id]);
    store.setCardArchived({ id: card.id, archived: false });
    expect((await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/retry', viewport: 'desktop' })).status).toBe('passed');
    store.close();
  });
  it('validates exact viewport choices before opening a browser and stores measured content sizes', async () => {
    const { store, card } = fixture();
    for (const viewport of ['', 'Desktop', 'mobile-large', '__proto__', 1280, null]) {
      await expect(runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/', viewport: viewport as 'desktop' })).rejects.toThrow('Prüfgröße');
    }
    expect(fake.windows).toHaveLength(0);
    for (const [viewport, width, height] of [['desktop', 1280, 800], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
      const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/', viewport });
      expect(fake.windows.at(-1)?.options).toMatchObject({ width, height, useContentSize: true });
      expect(report).toMatchObject({ viewportWidth: width, viewportHeight: height, screenshotAvailable: true });
      expect(cardQaReports(store, card.id)[0]).toMatchObject({ id: report.id, viewportWidth: width, viewportHeight: height });
    }
    store.close();
  });

  it('keeps a failed report with the actual size if the OS clamps the selected viewport', async () => {
    const { store, card } = fixture();
    fake.mode = 'clamped';
    const report = await runCardQa(store, { cardId: card.id, url: 'http://127.0.0.1:5173/', viewport: 'tablet' });
    expect(report).toMatchObject({ status: 'error', viewportWidth: 768, viewportHeight: 684, screenshotAvailable: false });
    expect(report.note).toContain('Prüfgröße konnte nicht gesetzt werden');
    expect(fake.windows[0]?.destroyed).toBe(true);
    store.close();
  });

  it('rejects remote, credential and non-web URLs before creating a browser or report', async () => {
    const { store, card } = fixture();
    expect(normalizeCardQaUrl('http://127.0.0.1:5173/?token=private')).toContain('127.0.0.1');
    for (const url of ['https://example.com/', 'https://localhost.evil.example/', 'file:///etc/passwd', 'http://user:pass@localhost:5173/']) {
      await expect(runCardQa(store, { viewport: 'desktop', cardId: card.id, url })).rejects.toThrow();
    }
    expect(fake.windows).toHaveLength(0);
    expect(cardQaReports(store, card.id)).toEqual([]);
    store.close();
  });

  it('records a sandboxed page error with sanitized source, persists it, and never starts an agent', async () => {
    const { file, store, project, card } = fixture();
    fake.mode = 'console';
    const report = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/page?token=private' });
    expect(report).toMatchObject({ status: 'failed', requestedUrl: 'http://127.0.0.1:5173/page', finalUrl: 'http://127.0.0.1:5173/page', screenshotAvailable: true, viewportWidth: 1280, viewportHeight: 800 });
    expect(report.diagnostics[0]).toMatchObject({ message: 'Synthetic TypeError', sourceUrl: 'http://127.0.0.1:5173/app.js', line: 7 });
    expect(fake.windows[0]).toMatchObject({ destroyed: true, options: { show: false, webPreferences: { sandbox: true, nodeIntegration: false, webSecurity: true } } });
    expect(fake.windows[0]!.options.webPreferences.partition).not.toContain('persist:');
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    expect(cardQaScreenshot(store, { cardId: card.id, reportId: report.id })).toMatch(/^data:image\/png;base64,/);
    store.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id)).toEqual([report]);
    reopened.close();
  });

  it('requires the matching card for a persisted screenshot', async () => {
    const { store, project, card } = fixture();
    const other = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Other' });
    const report = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/' });
    expect(() => cardQaScreenshot(store, { cardId: other.id, reportId: report.id })).toThrow('gehört nicht');
    store.close();
  });

  it('blocks requests outside the selected origin and distinguishes a clean limited pass', async () => {
    const { store, card } = fixture();
    fake.mode = 'remote';
    const blocked = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://localhost:5173/' });
    expect(blocked.status).toBe('failed');
    expect(blocked.diagnostics[0]?.message).toContain('blockiert');
    expect(JSON.stringify(blocked)).not.toContain('token=private');
    fake.mode = 'clean';
    const clean = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://localhost:5173/' });
    expect(clean.status).toBe('passed');
    expect(clean.diagnostics).toEqual([]);
    expect(cardQaReports(store, card.id).map((item) => item.id)).toEqual([clean.id, blocked.id]);
    store.close();
  });

  it('stores load failures without query values and releases the card for retry', async () => {
    const { store, card } = fixture();
    fake.mode = 'load-error';
    const failed = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/?token=private' });
    expect(failed.status).toBe('error');
    expect(failed.screenshotAvailable).toBe(false);
    expect(failed.note).toContain('ERR_CONNECTION_REFUSED');
    expect(JSON.stringify(failed)).not.toContain('token=private');
    fake.mode = 'clean';
    expect((await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/' })).status).toBe('passed');
    store.close();
  });

  it('keeps the QA result when screenshot capture fails, is empty, or exceeds the byte limit', async () => {
    const { store, card } = fixture();
    for (const mode of ['capture-error', 'capture-empty', 'capture-large'] as const) {
      fake.mode = mode;
      const report = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/' });
      expect(report).toMatchObject({ status: 'passed', screenshotAvailable: false, note: expect.stringContaining('Screenshot konnte nicht') });
      expect(() => cardQaScreenshot(store, { cardId: card.id, reportId: report.id })).toThrow('kein gültiger Screenshot');
    }
    store.close();
  });

  it('caps retained screenshots across cards without dropping the older QA reports', async () => {
    const { store, project, card } = fixture();
    const insert = store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, note, screenshot_png)
      VALUES (?, ?, ?, 'http://127.0.0.1/', 'http://127.0.0.1/', '2100-01-01', '2100-01-01', 'passed', '[]', NULL, ?)`);
    let oldestCardId = '';
    for (let index = 0; index < 100; index++) {
      const oldCard = store.createCard({ projectId: project.id, columnId: card.columnId, title: `Old ${index}` });
      if (index === 0) oldestCardId = oldCard.id;
      insert.run(`old-${index}`, oldCard.id, project.id, Buffer.from('synthetic'));
    }
    insert.run('future-same-card', card.id, project.id, Buffer.from('synthetic'));
    const newest = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/' });
    const retained = store.db.prepare('SELECT COUNT(*) AS count FROM card_qa_reports WHERE screenshot_png IS NOT NULL').get() as { count: number };
    expect(retained.count).toBe(100);
    expect(newest.screenshotAvailable).toBe(true);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM card_qa_reports').get()).toMatchObject({ count: 102 });
    expect(cardQaReports(store, card.id)[0]?.id).toBe(newest.id);
    expect(() => cardQaScreenshot(store, { cardId: oldestCardId, reportId: 'old-0' })).toThrow('kein gültiger Screenshot');
    store.close();
  });

  it('adds the screenshot column to an existing QA report table on upgrade', async () => {
    const { store, file, card } = fixture();
    const old = await runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/old' });
    store.close();
    const legacy = new Database(file);
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN screenshot_png');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN viewport_width');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN viewport_height');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN page_check');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN page_observations_json');
    legacy.exec('ALTER TABLE card_qa_reports DROP COLUMN git_evidence_json');
    legacy.close();
    const reopened = new StudioStore(file);
    expect(cardQaReports(reopened, card.id).find((item) => item.id === old.id)).toMatchObject({ viewportWidth: 0, viewportHeight: 0, screenshotAvailable: false, pageCheck: 'not-run', pageObservations: [], gitEvidence: null });
    const report = await runCardQa(reopened, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/' });
    expect(report).toMatchObject({ screenshotAvailable: true, viewportWidth: 1280, viewportHeight: 800 });
    reopened.close();
  });

  it('limits concurrent hidden QA windows across different cards', async () => {
    const { store, project, card } = fixture();
    const second = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Second' });
    const third = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Third' });
    fake.mode = 'slow';
    const firstRun = runCardQa(store, { viewport: 'desktop', cardId: card.id, url: 'http://127.0.0.1:5173/' });
    const secondRun = runCardQa(store, { viewport: 'desktop', cardId: second.id, url: 'http://127.0.0.1:5173/' });
    await vi.waitFor(() => expect(fake.releases).toHaveLength(2));
    await expect(runCardQa(store, { viewport: 'desktop', cardId: third.id, url: 'http://127.0.0.1:5173/' })).rejects.toThrow('zwei lokale QA-Prüfungen');
    for (const release of fake.releases.splice(0)) release();
    expect((await Promise.all([firstRun, secondRun])).map((report) => report.status)).toEqual(['passed', 'passed']);
    fake.mode = 'clean';
    expect((await runCardQa(store, { viewport: 'desktop', cardId: third.id, url: 'http://127.0.0.1:5173/' })).status).toBe('passed');
    store.close();
  });
});
