import { useEffect, useRef, useState } from 'react';
import type { DesignStateKind, DesignStateRoute } from '../../shared/design-state-routes';
import './design-state-routes.css';

const kinds: Array<{ kind: DesignStateKind; label: string }> = [
  { kind: 'normal', label: 'Normal' },
  { kind: 'loading', label: 'Loading' },
  { kind: 'empty', label: 'Empty' },
  { kind: 'error', label: 'Error' },
];
const labelOf = (kind: DesignStateKind): string => kinds.find((item) => item.kind === kind)!.label;
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

/** Keep query values out of the overview; the edit field still shows the user's exact saved URL. */
export function stateRouteSummary(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search || parsed.hash ? ' · Parameter oder Fragment vorhanden' : ''}`;
  } catch { return 'Gespeicherte Route ungültig. Entferne sie und speichere eine neue lokale URL.'; }
}

function routeOrigin(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

export function DesignStateRoutes({ projectId, active, previewBusy, themePreviewActive, onOpen }: {
  projectId: string;
  active: boolean;
  previewBusy: boolean;
  themePreviewActive: boolean;
  onOpen: (route: DesignStateRoute) => Promise<void>;
}) {
  const [routes, setRoutes] = useState<DesignStateRoute[]>([]);
  const [selected, setSelected] = useState<DesignStateKind>('normal');
  const [drafts, setDrafts] = useState<Partial<Record<DesignStateKind, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    let alive = true;
    setRoutes([]); setDrafts({}); setSelected('normal'); setLoading(true); setBusy(false); setError(''); setNotice('');
    void window.studio.designStateRoutes(projectId).then((items) => { if (alive) setRoutes(items); })
      .catch((reason: unknown) => { if (alive) setError(messageOf(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const saved = routes.find((item) => item.kind === selected);
  const draft = drafts[selected] ?? saved?.url ?? '';
  const changed = draft !== (saved?.url ?? '');
  const origin = routes.length ? routeOrigin(routes[0]!.url) : null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const route = await window.studio.saveDesignStateRoute({ projectId, kind: selected, url: draft });
      if (projectRef.current !== projectId) return;
      setRoutes((items) => [...items.filter((item) => item.kind !== selected), route]);
      setDrafts((items) => ({ ...items, [selected]: route.url }));
      setNotice(`${labelOf(selected)} gespeichert. Die Vorschau wurde nicht geöffnet.`);
    } catch (reason) { if (projectRef.current === projectId) setError(messageOf(reason)); }
    finally { if (projectRef.current === projectId) setBusy(false); }
  }

  async function remove() {
    if (!saved || busy || !window.confirm(`${labelOf(selected)}-Route aus diesem Projekt entfernen?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await window.studio.removeDesignStateRoute({ projectId, kind: selected });
      if (projectRef.current !== projectId) return;
      setRoutes((items) => items.filter((item) => item.kind !== selected));
      setDrafts((items) => ({ ...items, [selected]: '' }));
      setNotice(`${labelOf(selected)}-Route entfernt.`);
    } catch (reason) { if (projectRef.current === projectId) setError(messageOf(reason)); }
    finally { if (projectRef.current === projectId) setBusy(false); }
  }

  async function open() {
    if (!saved || changed || busy || previewBusy || !active || themePreviewActive) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await onOpen(saved);
      if (projectRef.current === projectId) setNotice(`${labelOf(selected)} geöffnet. Der Zustand stammt aus deiner lokalen App-Route.`);
    } catch (reason) { if (projectRef.current === projectId) setError(messageOf(reason)); }
    finally { if (projectRef.current === projectId) setBusy(false); }
  }

  return <section className="design-state-routes" aria-label="UI-Zustandsrouten">
    <div className="design-state-routes-head"><h3>UI-Zustände</h3><p>Speichere die Routen, die deine lokale App für Normal, Loading, Empty und Error wirklich bereitstellt. Branchloom erzeugt diese Zustände nicht selbst.</p></div>
    <div className="design-state-routes-tabs" role="group" aria-label="Zustand wählen">
      {kinds.map(({ kind, label }) => <button type="button" key={kind} aria-pressed={selected === kind} className="secondary-button" disabled={busy} onClick={() => { setSelected(kind); setError(''); setNotice(''); }}>
        <strong>{label}</strong><span>{routes.some((route) => route.kind === kind) ? 'Route gespeichert' : 'Keine Route'}</span>
      </button>)}
    </div>
    {loading ? <p role="status">Gespeicherte Routen werden geladen.</p> : <form onSubmit={(event) => void save(event)}>
      <label>Lokale URL für {labelOf(selected)}<input type="url" required maxLength={2048} value={draft} disabled={busy} placeholder="http://127.0.0.1:5173/?state=empty" onChange={(event) => setDrafts((items) => ({ ...items, [selected]: event.target.value }))} /></label>
      <div className="design-state-routes-actions">
        <button type="submit" className="secondary-button" disabled={busy || !draft.trim() || !changed}>{busy ? 'Bitte warten…' : 'Route speichern'}</button>
        <button type="button" className="secondary-button" disabled={!saved || changed || busy || previewBusy || !active || themePreviewActive} onClick={() => void open()}>Gespeicherte Route öffnen</button>
        {saved ? <button type="button" className="text-button" disabled={busy} onClick={() => void remove()}>Entfernen</button> : null}
      </div>
    </form>}
    {!loading ? <p className="design-state-routes-meta">{saved ? `Gespeichert: ${stateRouteSummary(saved.url)}` : `Für ${labelOf(selected)} fehlt noch eine Route.`}{origin ? ` Alle Zustände nutzen ${origin}.` : ''}</p> : null}
    {changed && saved ? <p className="design-state-routes-meta">Speichere die geänderte URL, bevor du sie öffnest.</p> : null}
    {themePreviewActive ? <p className="design-state-routes-meta">Setze die flüchtige Design-Vorschau zurück, bevor du die Route wechselst.</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
  </section>;
}
