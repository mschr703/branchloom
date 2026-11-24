import { useEffect, useState } from 'react';
import type { ReleaseUpdateState } from '../../shared/release-update';
import './release-update.css';

export function ReleaseUpdateNotice() {
  const [state, setState] = useState<ReleaseUpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.studio.onReleaseUpdateState((next) => { if (active) setState(next); });
    void window.studio.releaseUpdateState().then((next) => { if (active) setState(next); }).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, []);

  if (!state || !state.availableVersion || state.phase === 'unsupported' || state.phase === 'current') return null;

  const working = state.phase === 'downloading' || state.phase === 'installing';
  const title = state.phase === 'downloading' ? 'Update wird geladen'
    : state.phase === 'installing' ? 'Branchloom wird aktualisiert'
    : state.phase === 'blocked' ? 'Update bereit'
    : `Update ${state.availableVersion} verfügbar`;
  const detail = state.message ?? (state.phase === 'downloading'
    ? `Version ${state.availableVersion}${state.percent === null ? '' : ` · ${state.percent} %`}`
    : state.phase === 'installing' ? 'Die App wird für die Installation geschlossen und danach wieder geöffnet.'
    : `Installiert: ${state.currentVersion} · Neu: ${state.availableVersion}`);

  async function update() {
    setBusy(true);
    try { setState(await window.studio.installReleaseUpdate()); }
    finally { setBusy(false); }
  }

  async function later() {
    setBusy(true);
    try { setState(await window.studio.laterReleaseUpdate()); }
    finally { setBusy(false); }
  }

  return <aside className="release-update-notice" role="status" aria-live="polite" aria-label="Branchloom Update">
    <div className="release-update-copy"><strong>{title}</strong><span>{detail}</span></div>
    {state.phase === 'downloading' ? <progress aria-label="Update-Download" max={100} value={state.percent ?? undefined} /> : null}
    {!working ? <div className="release-update-actions">
      <button type="button" className="release-update-later" disabled={busy} onClick={() => void later()}>Später</button>
      <button type="button" className="release-update-now" disabled={busy} onClick={() => void update()}>{state.phase === 'blocked' ? 'Jetzt installieren' : state.phase === 'error' ? 'Erneut versuchen' : 'Aktualisieren'}</button>
    </div> : null}
  </aside>;
}
