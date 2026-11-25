import { BrowserWindow, safeStorage, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CardDevEnvironment } from '../shared/dev-environment';
import type { DevAccountProbe, DevAccountSeedCheck, DevAccountSeedAttempt, DevAccountSavedLoginStatus } from '../shared/dev-account';
import type { StudioStore } from './store';
import type { DevEnvironmentRunner } from './dev-environment';
import { cardDevAccountGrant, devAccountForProject, finishSeedAttempt, forgetDevLogin, lastSeedAttempt, recordSeedAttempt, savedDevLogin, saveDevLogin, saveSeedConfig, seedConfig } from './dev-account';
import { packAccountCookies, unpackAccountCookies } from './dev-account-login';
import { probeDevIdentity } from './dev-account-probe';
import { createSeedAccount, readSeedAccount, SeedEndpointError } from './dev-account-seed';
import { isLocalDevUrl } from './browser-policy';

interface AccountWindow { window: BrowserWindow; accountId: string; origin: string; runId: string }
interface AccountTarget { cardId: string; origin: string; runId: string }
interface SeedTicket { cardId: string; targetId: string; accountId: string; runId: string; origin: string; revision: string; expires: number }

/** Login remains in a separate, memory-only Chromium partition for each account. */
export class DevAccountBrowser {
  private readonly windows = new Map<string, AccountWindow>();
  private readonly sessions = new Map<string, Session>();
  private readonly probes = new Map<string, Set<AccountTarget>>();
  private readonly seedTickets = new Map<string, SeedTicket>();
  private readonly restoredLogins = new Map<string, 'saved' | 'restored' | 'unavailable'>();
  private readonly restoringLogins = new Map<string, Promise<void>>();
  private readonly loginGenerations = new Map<string, number>();
  private readonly requestOwnershipChecks = new Map<string, Promise<boolean>>();

  constructor(private readonly store: StudioStore, private readonly environments: DevEnvironmentRunner,
    private readonly parentWindow: () => BrowserWindow | null) {}

  private ready(cardId: string): CardDevEnvironment {
    const run = this.environments.card(cardId);
    if (!run || run.state !== 'ready' || !run.managed || !isLocalDevUrl(run.url)) {
      throw new Error('Start a ready, app-managed card preview before using a development account.');
    }
    // Account cookies must never be restored or sent to an unrelated listener
    // that took over a previously ready card port.
    return this.environments.verifyCurrentPreview(cardId, run.id);
  }

  private stillAllowed(cardId: string, accountId: string, runId: string, origin: string): boolean {
    try {
      if (!this.stillAssigned(cardId, accountId, runId, origin)) return false;
      const current = this.ready(cardId);
      return current.id === runId && new URL(current.url).origin === origin;
    } catch { return false; }
  }

  private stillAssigned(cardId: string, accountId: string, runId: string, origin: string): boolean {
    try {
      if (cardDevAccountGrant(this.store, cardId).id !== accountId) return false;
      const current = this.environments.card(cardId);
      return current?.id === runId && current.state === 'ready' && current.managed && new URL(current.url).origin === origin;
    } catch { return false; }
  }

  private async requestOwned(target: AccountTarget, accountId: string): Promise<boolean> {
    if (!this.stillAssigned(target.cardId, accountId, target.runId, target.origin)) return false;
    const key = `${target.cardId}\0${target.runId}\0${target.origin}`;
    let pending = this.requestOwnershipChecks.get(key);
    if (!pending) {
      pending = this.environments.verifyCurrentPreviewAsync(target.cardId, target.runId)
        .then((run) => run.state === 'ready' && run.managed && new URL(run.url).origin === target.origin)
        .catch(() => false)
        .finally(() => { if (this.requestOwnershipChecks.get(key) === pending) this.requestOwnershipChecks.delete(key); });
      this.requestOwnershipChecks.set(key, pending);
    }
    return await pending && this.stillAssigned(target.cardId, accountId, target.runId, target.origin);
  }

  private browserSession(accountId: string): Session {
    const existing = this.sessions.get(accountId);
    if (existing) return existing;
    const ses = session.fromPartition(`branchloom-dev-account-${accountId}`);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, callback) => {
      let targets: AccountTarget[] = [];
      try {
        const origin = new URL(details.url).origin;
        targets = [
          ...[...this.windows].filter(([, entry]) => entry.accountId === accountId && !entry.window.isDestroyed())
            .map(([cardId, entry]) => ({ cardId, origin: entry.origin, runId: entry.runId })),
          ...(this.probes.get(accountId) ?? []),
        ].filter((target) => target.origin === origin);
      }
      catch { /* A malformed URL never receives this account's browser session. */ }
      if (!targets.length) { callback({ cancel: true }); return; }
      void Promise.all(targets.map((target) => this.requestOwned(target, accountId)))
        .then((results) => callback({ cancel: !results.some(Boolean) }), () => callback({ cancel: true }));
    });
    this.sessions.set(accountId, ses);
    return ses;
  }

  private async encryptionAvailable(): Promise<boolean> {
    // Other OS providers need an explicit verification before enabling this public feature.
    return process.platform === 'win32' && await safeStorage.isAsyncEncryptionAvailable();
  }

  savedLoginStatus(cardId: string): DevAccountSavedLoginStatus {
    const account = cardDevAccountGrant(this.store, cardId);
    const saved = savedDevLogin(this.store, account.id);
    return { accountId: account.id, savedAt: saved?.savedAt ?? null,
      state: !saved ? 'none' : this.restoredLogins.get(account.id) ?? 'saved' };
  }

  private async restoreLogin(cardId: string, accountId: string, runId: string, origin: string): Promise<void> {
    const saved = savedDevLogin(this.store, accountId);
    if (!saved || this.restoredLogins.has(accountId)) return;
    const pending = this.restoringLogins.get(accountId);
    if (pending) return pending;
    const generation = this.loginGenerations.get(accountId) ?? 0;
    const restore = (async () => {
      try {
        if (!await this.encryptionAvailable()) throw new Error('Protected login storage is unavailable.');
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(saved.sealed);
        const cookies = unpackAccountCookies(result, accountId, origin);
        if (!cookies.length) throw new Error('Saved login has expired.');
        const ses = this.browserSession(accountId);
        for (const cookie of cookies) {
          if ((this.loginGenerations.get(accountId) ?? 0) !== generation || !this.stillAssigned(cardId, accountId, runId, origin)) return;
          await ses.cookies.set(cookie);
        }
        if ((this.loginGenerations.get(accountId) ?? 0) !== generation || !this.stillAllowed(cardId, accountId, runId, origin)) return;
        if (shouldReEncrypt) {
          const renewed = await safeStorage.encryptStringAsync(result);
          if ((this.loginGenerations.get(accountId) ?? 0) !== generation || !this.stillAllowed(cardId, accountId, runId, origin)) return;
          saveDevLogin(this.store, accountId, renewed);
        }
        this.restoredLogins.set(accountId, 'restored');
      } catch {
        // The manual login window remains usable. Never log decrypted cookie data.
        this.restoredLogins.set(accountId, 'unavailable');
      }
    })();
    this.restoringLogins.set(accountId, restore);
    try { await restore; } finally { this.restoringLogins.delete(accountId); }
  }

  async saveLogin(cardId: string): Promise<DevAccountSavedLoginStatus> {
    const account = cardDevAccountGrant(this.store, cardId);
    const run = this.ready(cardId);
    const origin = new URL(run.url).origin;
    if (!await this.encryptionAvailable()) throw new Error('Protected login storage is unavailable on this system.');
    if ((await this.probe(cardId)).state !== 'verified') throw new Error('Verify the assigned account before saving its login.');
    const generation = this.loginGenerations.get(account.id) ?? 0;
    const cookies = await this.browserSession(account.id).cookies.get({});
    const packed = packAccountCookies(account.id, origin, cookies);
    const sealed = await safeStorage.encryptStringAsync(packed);
    if ((this.loginGenerations.get(account.id) ?? 0) !== generation || !this.stillAllowed(cardId, account.id, run.id, origin)) {
      throw new Error('Card grant or preview changed while saving the login.');
    }
    saveDevLogin(this.store, account.id, sealed);
    this.restoredLogins.set(account.id, 'saved');
    return this.savedLoginStatus(cardId);
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
    await this.restoreLogin(cardId, account.id, run.id, origin);
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
    await this.restoreLogin(cardId, account.id, run.id, origin);
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

  seedConfig(cardId: string) {
    const account = cardDevAccountGrant(this.store, cardId);
    return seedConfig(this.store, account.projectId, account.service, account.environment);
  }

  saveSeedConfig(input: { cardId: string; path: string }) {
    const account = cardDevAccountGrant(this.store, input.cardId);
    this.seedTickets.clear();
    return saveSeedConfig(this.store, { projectId: account.projectId, service: account.service, environment: account.environment, path: input.path });
  }

  lastSeedAttempt(cardId: string, targetId: string): DevAccountSeedAttempt | null {
    const account = cardDevAccountGrant(this.store, cardId);
    const target = devAccountForProject(this.store, account.projectId, targetId);
    if (account.service !== target.service || account.environment !== target.environment) throw new Error('Seed target belongs to another service or environment.');
    return lastSeedAttempt(this.store, account.projectId, target.id);
  }

  private seedContext(cardId: string, targetId: string) {
    const account = cardDevAccountGrant(this.store, cardId);
    const target = devAccountForProject(this.store, account.projectId, targetId);
    if (account.id === target.id || account.service !== target.service || account.environment !== target.environment) {
      throw new Error('Choose another account in the same service and environment.');
    }
    const config = seedConfig(this.store, account.projectId, account.service, account.environment);
    if (!config) throw new Error('Set the local seed endpoint first.');
    const run = this.ready(cardId);
    const origin = new URL(run.url).origin;
    return { account, target, config, run, origin };
  }

  private async withSeedSession<T>(cardId: string, accountId: string, runId: string, origin: string,
    work: (request: (url: string, init: RequestInit) => Promise<Response>, stillAllowed: () => boolean) => Promise<T>): Promise<T> {
    const ses = this.browserSession(accountId);
    const target: AccountTarget = { cardId, origin, runId };
    let active = this.probes.get(accountId);
    if (!active) { active = new Set<AccountTarget>(); this.probes.set(accountId, active); }
    active.add(target);
    try { return await work((url, init) => ses.fetch(url, init), () => this.stillAllowed(cardId, accountId, runId, origin)); }
    finally { active.delete(target); if (!active.size) this.probes.delete(accountId); }
  }

  async checkSeed(cardId: string, targetId: string): Promise<DevAccountSeedCheck> {
    const { account, target, config, run, origin } = this.seedContext(cardId, targetId);
    const checkedAt = new Date().toISOString();
    const result = (state: DevAccountSeedCheck['state'], id: string | null = null): DevAccountSeedCheck => ({ id, targetId, state, checkedAt });
    const identity = await this.probe(cardId);
    if (identity.state !== 'verified') return result(identity.state);
    try {
      const state = await this.withSeedSession(cardId, account.id, run.id, origin, (request, stillAllowed) =>
        readSeedAccount({ origin, path: config.path, target, request, stillAllowed }));
      if (state === 'exists') return result('exists');
      const id = randomUUID();
      this.seedTickets.set(id, { cardId, targetId, accountId: account.id, runId: run.id, origin, revision: config.revision, expires: Date.now() + 300_000 });
      return result('missing', id);
    } catch (error) {
      if (error instanceof SeedEndpointError && error.status === 401) return result('login-required');
      if (error instanceof SeedEndpointError && error.status === 403) return result('access-denied');
      return result('unavailable');
    }
  }

  async createSeed(cardId: string, targetId: string, checkId: string): Promise<DevAccountSeedAttempt> {
    const ticket = this.seedTickets.get(checkId);
    this.seedTickets.delete(checkId);
    if (!ticket || ticket.cardId !== cardId || ticket.targetId !== targetId || ticket.expires < Date.now()) throw new Error('Seed check expired. Check the target again.');
    const { account, target, config, run, origin } = this.seedContext(cardId, targetId);
    if (account.id !== ticket.accountId || run.id !== ticket.runId || origin !== ticket.origin || config.revision !== ticket.revision) {
      throw new Error('Card grant, preview or seed config changed. Check the target again.');
    }
    const identity = await this.probe(cardId);
    if (identity.state !== 'verified') throw new Error('Provisioner login is no longer verified.');
    return this.withSeedSession(cardId, account.id, run.id, origin, async (request, stillAllowed) => {
      const present = await readSeedAccount({ origin, path: config.path, target, request, stillAllowed });
      const id = randomUUID();
      const attempt = recordSeedAttempt(this.store, { id, projectId: account.projectId, cardId, provisionerId: account.id,
        targetId, state: present === 'exists' ? 'already-exists' : 'requested' });
      if (present === 'exists') return attempt;
      try {
        await createSeedAccount({ origin, path: config.path, target, requestId: id, request, stillAllowed });
        finishSeedAttempt(this.store, id, 'created');
        return { ...attempt, state: 'created' };
      } catch (error) {
        // A POST can reach the app before a timeout or malformed reply. Preserve uncertainty.
        finishSeedAttempt(this.store, id, 'unknown');
        throw error;
      }
    });
  }

  closeCard(cardId: string): void {
    const found = this.windows.get(cardId);
    if (!found) return;
    this.windows.delete(cardId);
    if (!found.window.isDestroyed()) found.window.destroy();
  }

  async forget(accountId: string): Promise<void> {
    this.loginGenerations.set(accountId, (this.loginGenerations.get(accountId) ?? 0) + 1);
    forgetDevLogin(this.store, accountId);
    await this.restoringLogins.get(accountId);
    for (const [cardId, found] of [...this.windows]) if (found.accountId === accountId) this.closeCard(cardId);
    const ses = this.sessions.get(accountId);
    if (ses) await ses.clearStorageData();
    this.restoredLogins.delete(accountId);
  }

  closeAll(): void { for (const cardId of [...this.windows.keys()]) this.closeCard(cardId); }
  dispose(): void { this.closeAll(); this.sessions.clear(); this.probes.clear(); this.seedTickets.clear(); this.restoredLogins.clear(); this.requestOwnershipChecks.clear(); }
}
