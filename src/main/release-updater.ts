import type { ReleaseUpdateState } from '../shared/release-update';

function checkFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/\b429\b|rate.?limit/i.test(detail)) return 'GitHub begrenzt die Updateprüfung gerade. Später erneut prüfen.';
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONN|offline|network/i.test(detail)) return 'Keine Verbindung für die Updateprüfung. Später erneut prüfen.';
  if (/\b404\b|not found|missing|checksum|sha.?512|invalid|asset|parse/i.test(detail))
    return 'Release-Daten fehlen oder sind ungültig. Es wurde nichts heruntergeladen.';
  return 'Die Updateprüfung ist fehlgeschlagen. Später erneut prüfen.';
}

export interface ReleaseUpdateBackend {
  check(): Promise<void>;
  download(): Promise<void>;
  install(): void;
  onAvailable(callback: (version: string) => void): void;
  onCurrent(callback: () => void): void;
  onProgress(callback: (percent: number) => void): void;
  onError(callback: (error: Error) => void): void;
}

export class ReleaseUpdateController {
  private state: ReleaseUpdateState;
  private dismissedVersion: string | null = null;
  private downloadReady = false;
  private checking = false;

  constructor(
    private readonly backend: ReleaseUpdateBackend | null,
    currentVersion: string,
    private readonly emit: (state: ReleaseUpdateState) => void,
    private readonly canInstall: () => boolean,
  ) {
    this.state = { phase: backend ? 'current' : 'unsupported', currentVersion, availableVersion: null, percent: null, message: null };
    backend?.onAvailable((version) => {
      if (version !== this.state.availableVersion) this.downloadReady = false;
      this.set({ phase: version === this.dismissedVersion ? 'current' : 'available', availableVersion: version, percent: null, message: null });
    });
    backend?.onCurrent(() => {
      if (this.state.phase === 'downloading' || this.state.phase === 'installing') return;
      this.set({ phase: 'current', availableVersion: null, percent: null, message: null });
    });
    backend?.onProgress((percent) => {
      if (this.state.phase !== 'downloading') return;
      this.set({ percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null });
    });
    backend?.onError((error) => {
      if (this.checking && !this.state.availableVersion) {
        this.set({ phase: 'error', availableVersion: null, percent: null, message: checkFailureMessage(error) });
        return;
      }
      if (this.state.phase === 'installing') {
        this.set({ phase: 'error', percent: null, message: 'Die Installation konnte nicht gestartet werden. Versuche es erneut.' });
      } else if (this.state.phase === 'downloading') {
        this.set({ phase: 'error', percent: null, message: 'Der Download ist fehlgeschlagen. Du kannst es erneut versuchen.' });
      }
    });
  }

  snapshot(): ReleaseUpdateState { return { ...this.state }; }

  async check(): Promise<void> {
    if (!this.backend || this.checking || this.state.phase === 'downloading' || this.state.phase === 'installing') return;
    this.checking = true;
    if (this.state.phase === 'error' && !this.state.availableVersion) this.set({ phase: 'current', message: null });
    try { await this.backend.check(); }
    catch (error) {
      if (!this.state.availableVersion) this.set({ phase: 'error', availableVersion: null, percent: null, message: checkFailureMessage(error) });
    } finally { this.checking = false; }
  }

  later(): ReleaseUpdateState {
    if (this.state.availableVersion) this.dismissedVersion = this.state.availableVersion;
    this.set({ phase: this.backend ? 'current' : 'unsupported', percent: null, message: null });
    return this.snapshot();
  }

  async update(): Promise<ReleaseUpdateState> {
    if (!this.backend) return this.snapshot();
    if (!this.state.availableVersion) {
      if (this.state.phase === 'error') await this.check();
      return this.snapshot();
    }
    if (!['available', 'blocked', 'error'].includes(this.state.phase)) return this.snapshot();
    if (!this.downloadReady) {
      this.set({ phase: 'downloading', percent: 0, message: null });
      try {
        await this.backend.download();
        if (this.state.phase !== 'downloading') return this.snapshot();
        this.downloadReady = true;
      }
      catch {
        this.set({ phase: 'error', percent: null, message: 'Der Download ist fehlgeschlagen. Du kannst es erneut versuchen.' });
        return this.snapshot();
      }
    }
    if (!this.canInstall()) {
      this.set({ phase: 'blocked', percent: null, message: 'Schließe laufende Agenten, Terminals und Workflows. Danach kannst du das Update installieren.' });
      return this.snapshot();
    }
    this.set({ phase: 'installing', percent: 100, message: null });
    try { this.backend.install(); }
    catch {
      this.set({ phase: 'error', percent: null, message: 'Die Installation konnte nicht gestartet werden. Versuche es erneut.' });
    }
    return this.snapshot();
  }

  private set(patch: Partial<ReleaseUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit(this.snapshot());
  }
}
