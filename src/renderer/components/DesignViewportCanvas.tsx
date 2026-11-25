import { useEffect, useRef, useState } from 'react';
import type { DesignViewportResult } from '../../shared/design-viewports';
import './design-viewport-canvas.css';

const names = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' } as const;
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function DesignViewportCanvas({ projectId, ready, themePreviewActive, revision }: {
  projectId: string; ready: boolean; themePreviewActive: boolean; revision: number;
}) {
  const [result, setResult] = useState<DesignViewportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const cancelRequested = useRef(false);
  const captureButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    generation.current++;
    setResult(null); setBusy(false); setCanceling(false); setError('');
    return () => { generation.current++; void window.studio.designViewportCancel(projectId).catch(() => undefined); };
  }, [projectId, revision, ready, themePreviewActive]);

  async function capture() {
    if (!ready || busy || themePreviewActive) return;
    const current = ++generation.current;
    cancelRequested.current = false;
    setResult(null); setError(''); setBusy(true); setCanceling(false);
    try {
      const fresh = await window.studio.designViewportCapture(projectId);
      if (generation.current === current && !cancelRequested.current) setResult(fresh);
    } catch (reason) {
      if (generation.current === current && !cancelRequested.current) setError(messageOf(reason));
    } finally { if (generation.current === current) { setBusy(false); setCanceling(false); if (cancelRequested.current) setError('Größenaufnahme abgebrochen.'); } }
  }

  function cancel() {
    cancelRequested.current = true;
    setCanceling(true);
    void window.studio.designViewportCancel(projectId).catch((reason: unknown) => setError(messageOf(reason)));
    captureButton.current?.focus();
  }

  function close() {
    setResult(null);
    captureButton.current?.focus();
  }

  return <section className="design-viewport-canvas" aria-label="Design in drei Größen">
    <div className="design-viewport-canvas-head"><div><h3>Drei Größen prüfen</h3><p>Eine manuelle Aufnahme lädt dieselbe lokale Route nacheinander in drei frischen, getrennten Browsern. Es sind Momentaufnahmen, keine gleichzeitig laufenden Seiten.</p></div>
      <div className="design-viewport-canvas-actions"><button ref={captureButton} type="button" className="secondary-button" disabled={!ready || busy || themePreviewActive} onClick={() => void capture()}>Größen aufnehmen</button>
        {busy ? <button type="button" className="secondary-button" disabled={canceling} onClick={cancel}>{canceling ? 'Bricht ab…' : 'Abbrechen'}</button> : null}</div>
    </div>
    {themePreviewActive ? <p className="inline-note">Setze die flüchtige Design-Vorschau vor der Aufnahme zurück. Die neuen Browser übernehmen sie nicht.</p> : null}
    {!ready ? <p className="section-copy">Öffne oben zuerst eine lokale Design-Vorschau.</p> : null}
    {busy ? <p role="status" className="section-copy">Desktop, Tablet und Mobile werden nacheinander geladen. Bis zu drei lokale Seitenaufrufe sind nötig.</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {result ? <div className="design-viewport-canvas-result" role="group" aria-label="Aufnahmen in drei Größen"><p className="design-viewport-source">Route: {result.sourceUrl}</p>
      <div className="design-viewport-canvas-grid">{result.captures.map((item) => <figure key={item.size}>
        <figcaption><strong>{names[item.size]}</strong><span>{item.width} × {item.height} px</span></figcaption>
        {item.image ? <img src={item.image} alt={`${names[item.size]}-Aufnahme der lokalen Vorschau`} /> : <p className="design-viewport-missing">{item.error ?? 'Keine Aufnahme verfügbar.'}</p>}
        {item.sourceUrl !== result.sourceUrl ? <span className="design-viewport-loaded">Geladen: {item.sourceUrl}</span> : null}
        {item.capturedAt ? <time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString('de-DE')}</time> : null}
      </figure>)}</div>
      <div className="design-viewport-canvas-foot"><p>Bilder bleiben nur in dieser geöffneten Ansicht. Seitenskripte wurden beim Laden ausgeführt; Interaktionen und Layoutqualität sind nicht automatisch geprüft.</p><button type="button" className="secondary-button small" onClick={close}>Aufnahmen schließen</button></div>
    </div> : null}
  </section>;
}
