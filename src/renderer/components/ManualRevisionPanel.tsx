import { useEffect, useState } from 'react';
import type { ManualMergePreview, ManualRevision } from '../../shared/manual-revision';
import './manual-revision.css';

const errorText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function ManualConflictChoices({ preview, busy, onChoose }: { preview: ManualMergePreview; busy: boolean;
  onChoose: (conflictId: string, choice: 'manual' | 'agent') => void }) {
  if (!preview.conflicts.length) return null;
  return <div className="manual-revision-conflicts" aria-label="Überschneidungen">
    {preview.conflicts.map((conflict, index) => <fieldset key={conflict.id} disabled={busy || Boolean(preview.staleReason)}>
      <legend>Überschneidung {index + 1} von {preview.conflicts.length}{conflict.choice ? ' · entschieden' : ' · Entscheidung offen'}</legend>
      <div className="manual-revision-variants"><div><h4>Gemeinsame Basis</h4><pre>{conflict.base || '(leer)'}</pre></div><div><h4>Manuelle Fassung</h4><pre>{conflict.manual || '(leer)'}</pre></div><div><h4>Agentenfassung</h4><pre>{conflict.agent || '(leer)'}</pre></div></div>
      <div className="manual-revision-choices"><label><input type="radio" name={`manual-conflict-${conflict.id}`} checked={conflict.choice === 'manual'} onChange={() => onChoose(conflict.id, 'manual')} />Manuelle Fassung übernehmen</label>
        <label><input type="radio" name={`manual-conflict-${conflict.id}`} checked={conflict.choice === 'agent'} onChange={() => onChoose(conflict.id, 'agent')} />Agentenfassung übernehmen</label></div>
      {conflict.chosenAt ? <small>Gespeichert: {new Date(conflict.chosenAt).toLocaleString('de-DE')}</small> : null}
    </fieldset>)}
  </div>;
}

export function ManualRevisionPanel({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<ManualRevision[]>([]);
  const [path, setPath] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [preview, setPreview] = useState<ManualMergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all([window.studio.manualRevisionFiles(cardId), window.studio.manualRevisions(cardId)])
      .then(([nextFiles, nextRevisions]) => {
        if (!live) return;
        setFiles(nextFiles); setPath(nextFiles[0] ?? ''); setRevisions(nextRevisions);
        setRevisionId(nextRevisions[0]?.id ?? '');
      }).catch((reason) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [cardId, open]);

  async function refresh() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const [nextFiles, nextRevisions] = await Promise.all([window.studio.manualRevisionFiles(cardId), window.studio.manualRevisions(cardId)]);
      setFiles(nextFiles); setPath((current) => nextFiles.includes(current) ? current : nextFiles[0] ?? '');
      setRevisions(nextRevisions); setRevisionId((current) => nextRevisions.some((item) => item.id === current) ? current : nextRevisions[0]?.id ?? '');
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function capture() {
    if (!path || busy) return;
    setBusy(true); setError(''); setPreview(null);
    try {
      const saved = await window.studio.captureManualRevision({ cardId, path });
      setRevisions((old) => [saved, ...old]); setRevisionId(saved.id);
      setPreview(await window.studio.previewManualRevision(saved.id));
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function compare() {
    if (!revisionId || busy) return;
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await window.studio.previewManualRevision(revisionId)); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!preview || busy || preview.resolvedCombined === null || preview.staleReason) return;
    setBusy(true); setError('');
    try {
      const saved = await window.studio.applyManualRevision({ revisionId: preview.revision.id, previewToken: preview.previewToken, resolutionToken: preview.resolutionToken, confirm: true });
      setRevisions((old) => old.map((item) => item.id === saved.id ? saved : item));
      setPreview(await window.studio.previewManualRevision(saved.id));
      setFiles(await window.studio.manualRevisionFiles(cardId));
    } catch (reason) {
      setError(errorText(reason));
      setPreview(await window.studio.previewManualRevision(preview.revision.id).catch(() => null));
    } finally { setBusy(false); }
  }

  async function choose(conflictId: string, choice: 'manual' | 'agent') {
    if (!preview || busy || preview.staleReason) return;
    setBusy(true); setError('');
    try {
      setPreview(await window.studio.setManualRevisionConflictChoice({ revisionId: preview.revision.id,
        previewToken: preview.previewToken, conflictId, choice }));
    } catch (reason) {
      setError(errorText(reason));
      setPreview(await window.studio.previewManualRevision(preview.revision.id).catch(() => null));
    } finally { setBusy(false); }
  }

  return <section className="manual-revision" aria-label="Manuelle Zwischenänderungen">
    <div className="manual-revision-heading"><h3>Manuelle Zwischenänderungen</h3><button className="text-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Schließen' : 'Öffnen'}</button></div>
    {open ? <>
    <button className="text-button" type="button" disabled={busy} onClick={() => void refresh()}>Dateien aktualisieren</button>
    <p>Eine bewusst ausgewählte Textdatei mit dem Karten-Commit vergleichen. Der Vergleich schreibt noch nichts.</p>
    <div className="manual-revision-row"><label>Geänderte Zieldatei<select value={path} onChange={(event) => setPath(event.target.value)} disabled={busy || files.length === 0}>
      {files.length ? files.map((file) => <option key={file} value={file}>{file}</option>) : <option value="">Keine passende Datei</option>}
    </select></label><button className="secondary-button" type="button" disabled={busy || !path} onClick={() => void capture()}>Änderung festhalten</button></div>
    {revisions.length ? <div className="manual-revision-row"><label>Gespeicherte Revision<select value={revisionId} onChange={(event) => { setRevisionId(event.target.value); setPreview(null); }} disabled={busy}>
      {revisions.map((item) => <option key={item.id} value={item.id}>{item.path} · {new Date(item.capturedAt).toLocaleString('de-DE')}{item.appliedAt ? ' · angewendet' : ''}</option>)}
    </select></label><button className="text-button" type="button" disabled={busy || !revisionId} onClick={() => void compare()}>Dreifachvergleich öffnen</button></div> : null}
    {preview ? <div className="manual-revision-result">
      <p><strong>{preview.hasConflicts ? 'Überschneidung' : 'Zusammenführbar'}</strong> · Basis {preview.revision.baseHead.slice(0, 8)} · Agent {preview.sourceHead.slice(0, 8)}</p>
      {preview.staleReason ? <p className="inline-error" role="alert">{preview.staleReason}</p> : null}
      {preview.hasConflicts ? <p>Beide Seiten haben dieselbe Stelle geändert. Wähle für jede Überschneidung eine Fassung. Die Wahl bleibt für diese Vorschau gespeichert.</p> : <p>Die Vorschau enthält beide Änderungen. Prüfe sie vor dem ausdrücklichen Schreiben in die Zieldatei.</p>}
      <ManualConflictChoices preview={preview} busy={busy} onChoose={(id, choice) => void choose(id, choice)} />
      <details><summary>Vollständige Quelldateien</summary><div className="manual-revision-variants"><div><h4>Gemeinsame Basis</h4><pre>{preview.base}</pre></div><div><h4>Manuelle Revision</h4><pre>{preview.manual}</pre></div><div><h4>Agenten-Commit</h4><pre>{preview.agent}</pre></div></div></details>
      <details open={preview.hasConflicts}><summary>{preview.resolvedCombined === null ? 'Unentschiedener Vergleich' : 'Ergebnis vor dem Schreiben'}</summary><pre>{preview.resolvedCombined ?? preview.combined}</pre></details>
      {preview.resolvedCombined !== null && !preview.staleReason ? <><p>Es wird nur diese eine Zieldatei geschrieben. Der Ziel-Checkout bleibt danach absichtlich uncommittet; die Integrationswarteschlange übernimmt ihn nicht automatisch.</p>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void apply()}>Diese Datei zusammengeführt schreiben</button></> : null}
    </div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </> : null}
  </section>;
}
