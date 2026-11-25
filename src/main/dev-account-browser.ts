import { BrowserWindow, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CardDevEnvironment } from '../shared/dev-environment';
import type { DevAccountProbe, DevAccountSeedCheck, DevAccountSeedAttempt } from '../shared/dev-account';
import type { StudioStore } from './store';
import type { DevEnvironmentRunner } from './dev-environment';
import { cardDevAccountGrant, devAccountForProject, finishSeedAttempt, lastSeedAttempt, recordSeedAttempt, saveSeedConfig, seedConfig } from './dev-account';
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
    for (const [cardId, found] of [...this.windows]) if (found.accountId === accountId) this.closeCard(cardId);
    const ses = this.sessions.get(accountId);
    if (ses) await ses.clearStorageData();
  }

  closeAll(): void { for (const cardId of [...this.windows.keys()]) this.closeCard(cardId); }
  dispose(): void { this.closeAll(); this.sessions.clear(); this.probes.clear(); this.seedTickets.clear(); }
}
