import { BrowserWindow, session, type Session } from 'electron';
import type { CardDevEnvironment } from '../shared/dev-environment';
import type { DevAccountProbe } from '../shared/dev-account';
import type { StudioStore } from './store';
import type { DevEnvironmentRunner } from './dev-environment';
import { cardDevAccountGrant } from './dev-account';
import { probeDevIdentity } from './dev-account-probe';
import { isLocalDevUrl } from './browser-policy';

interface AccountWindow { window: BrowserWindow; accountId: string; origin: string; runId: string }
interface AccountTarget { cardId: string; origin: string; runId: string }

/** Login remains in a separate, memory-only Chromium partition for each account. */
export class DevAccountBrowser {
  private readonly windows = new Map<string, AccountWindow>();
  private readonly sessions = new Map<string, Session>();
  private readonly probes = new Map<string, Set<AccountTarget>>();

  constructor(private readonly store: StudioStore, private readonly environments: DevEnvironmentRunner,
    private readonly parentWindow: () => BrowserWindow | null) {}

  private ready(cardId: string): CardDevEnvironment {
    const run = this.environments.card(cardId);
    if (!run || run.state !== 'ready' || !run.managed || !isLocalDevUrl(run.url)) {
      throw new Error('Start a ready, app-managed card preview before using a development account.');
    }
    return run;
  }

  private stillAllowed(cardId: string, accountId: string, runId: string, origin: string): boolean {
    try {
      if (cardDevAccountGrant(this.store, cardId).id !== accountId) return false;
      const current = this.ready(cardId);
      return current.id === runId && new URL(current.url).origin === origin;
    } catch { return false; }
  }

  private browserSession(accountId: string): Session {
    const existing = this.sessions.get(accountId);
    if (existing) return existing;
    const ses = session.fromPartition(`branchloom-dev-account-${accountId}`);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        const origin = new URL(details.url).origin;
        const targets: AccountTarget[] = [
          ...[...this.windows].filter(([, entry]) => entry.accountId === accountId && !entry.window.isDestroyed())
            .map(([cardId, entry]) => ({ cardId, origin: entry.origin, runId: entry.runId })),
          ...(this.probes.get(accountId) ?? []),
        ];
        allowed = targets.some((target) => target.origin === origin && this.stillAllowed(target.cardId, accountId, target.runId, origin));
      }
      catch { /* A malformed URL never receives this account's browser session. */ }
      callback({ cancel: !allowed });
    });
    this.sessions.set(accountId, ses);
    return ses;
  }

  async open(cardId: string): Promise<string> {
    const account = cardDevAccountGrant(this.store, cardId);
    const run = this.ready(cardId);
    const origin = new URL(run.url).origin;
    const existing = this.windows.get(cardId);
    if (existing && existing.accountId === account.id && existing.origin === origin && existing.runId === run.id && !existing.window.isDestroyed()) {
      existing.window.show(); existing.window.focus();
      return run.url;
    }
    this.closeCard(cardId);
    const parent = this.parentWindow();
    if (!parent || parent.isDestroyed()) throw new Error('The Branchloom window is not available.');
    const ses = this.browserSession(account.id);
    const browser = new BrowserWindow({ parent, show: false, width: 1050, height: 760,
      title: `${account.service} · ${account.role}`, autoHideMenuBar: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false } });
    this.windows.set(cardId, { window: browser, accountId: account.id, origin, runId: run.id });
    browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const sameOrigin = (event: Electron.Event, url: string) => {
      try { if (new URL(url).origin === origin) return; } catch { /* Deny malformed navigation. */ }
      event.preventDefault();
    };
    browser.webContents.on('will-navigate', sameOrigin);
    browser.webContents.on('will-redirect', sameOrigin);
    browser.on('closed', () => {
      if (this.windows.get(cardId)?.window === browser) this.windows.delete(cardId);
    });
    try {
      await browser.loadURL(run.url);
      if (!this.stillAllowed(cardId, account.id, run.id, origin)) throw new Error('Card grant or development preview changed while opening the account.');
      browser.show();
      return run.url;
    } catch {
      if (!browser.isDestroyed()) browser.destroy();
      throw new Error('The assigned account window could not open the current card preview.');
    }
  }

  async probe(cardId: string): Promise<DevAccountProbe> {
    const account = cardDevAccountGrant(this.store, cardId);
    const run = this.ready(cardId);
    const origin = new URL(run.url).origin;
    const opened = this.windows.get(cardId);
    if (opened && (opened.accountId !== account.id || opened.origin !== origin || opened.runId !== run.id)) this.closeCard(cardId);
    const ses = this.browserSession(account.id);
    const target: AccountTarget = { cardId, origin, runId: run.id };
    let active = this.probes.get(account.id);
    if (!active) { active = new Set<AccountTarget>(); this.probes.set(account.id, active); }
    active.add(target);
    try {
      return await probeDevIdentity({ account, cardId, origin,
        request: (url, init) => ses.fetch(url, init),
        stillAllowed: () => this.stillAllowed(cardId, account.id, run.id, origin) });
    } finally { active.delete(target); if (!active.size) this.probes.delete(account.id); }
  }

  closeCard(cardId: string): void {
    const found = this.windows.get(cardId);
    if (!found) return;
    this.windows.delete(cardId);
    if (!found.window.isDestroyed()) found.window.destroy();
  }

  async forget(accountId: string): Promise<void> {
    for (const [cardId, found] of [...this.windows]) if (found.accountId === accountId) this.closeCard(cardId);
    const ses = this.sessions.get(accountId);
    if (ses) await ses.clearStorageData();
  }

  closeAll(): void { for (const cardId of [...this.windows.keys()]) this.closeCard(cardId); }
  dispose(): void { this.closeAll(); this.sessions.clear(); this.probes.clear(); }
}
