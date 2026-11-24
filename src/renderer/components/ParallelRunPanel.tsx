import { useEffect, useRef, useState } from 'react';
import type { CardRunGate } from '../../shared/parallel-runs';
import type { Card } from '../../shared/types';
import type { Mutate } from './shared';

export function ParallelRunPanel({ card, cards, mutate, onGate }: { card: Card; cards: Card[]; mutate: Mutate; onGate: (gate: CardRunGate | null) => void }) {
  const [gate, setGate] = useState<CardRunGate | null>(null);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');
  const [dependencyId, setDependencyId] = useState('');
  const [note, setNote] = useState('');
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const editingDependencies = useRef(false);

  function accept(next: CardRunGate) {
    setGate(next);
    onGate(next);
    if (!editingDependencies.current) setExtraIds(next.dependencies.filter((item) => item.source === 'manual').map((item) => item.prerequisiteCardId));
  }

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await window.studio.cardRunGate(card.id);
        if (active) { accept(next); setError(''); }
      } catch (reason) {
        if (active) { setGate(null); onGate(null); setError(reason instanceof Error ? reason.message : String(reason)); }
      }
    };
    setGate(null); onGate(null); setReportId(''); setDependencyId(''); setNote(''); setExtraIds([]); editingDependencies.current = false;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [card.id, onGate]);

  async function changeCapacity(capacity: number) {
    setBusy(true); setError('');
    try {
      const updated = await mutate(() => window.studio.setProjectRunCapacity({ projectId: card.projectId, capacity }));
      if (updated !== null) accept(await window.studio.cardRunGate(card.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function saveDependencies(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const next = await mutate(() => window.studio.setCardRunDependencies({ cardId: card.id, prerequisiteCardIds: extraIds }));
      if (next) { editingDependencies.current = false; accept(next); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const blockedWithQa = gate?.dependencies.filter((item) => item.status === 'blocked' && item.reports.length) ?? [];
  const selected = blockedWithQa.find((item) => item.prerequisiteCardId === dependencyId) ?? blockedWithQa[0];

  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const next = await mutate(() => window.studio.approveCardDependency({ cardId: card.id, prerequisiteCardId: selected.prerequisiteCardId, qaReportId: reportId, note }));
      if (next) { accept(next); setNote(''); setReportId(''); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const fixed = new Set(gate?.dependencies.filter((item) => item.source === 'split').map((item) => item.prerequisiteCardId) ?? []);
  const candidates = cards.filter((item) => item.projectId === card.projectId && item.id !== card.id && !item.archivedAt);

  return <section className="stacked-form" aria-label="Parallele Kartenläufe">
    <div className="section-heading"><h3>Parallele Läufe</h3></div>
    {gate ? <>
      <label className="field-label">Agenten gleichzeitig im Projekt
        <select value={gate.capacity} disabled={busy} onChange={(event) => void changeCapacity(Number(event.target.value))}>
          {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <p className="run-meta" role="status">{gate.runningCount} von {gate.capacity} Plätzen belegt.</p>
      {gate.running.length ? <ul>{gate.running.map((run) => <li key={run.sessionId}>{run.title} · {run.worktreePath ? 'eigener Worktree' : 'Projektordner'}</li>)}</ul> : null}
      <details>
        <summary>Vorgänger festlegen · {gate.dependencies.length}</summary>
        <p className="field-help">Diese Karte startet erst nach belegten Ergebnissen aller Vorgänger. Ein Vorgänger aus einer Teilung bleibt fest zugeordnet.</p>
        <form className="stacked-form" onSubmit={(event) => void saveDependencies(event)}>
          {candidates.map((item) => <label className="check-option" key={item.id}><input type="checkbox" checked={fixed.has(item.id) || extraIds.includes(item.id)} disabled={busy || fixed.has(item.id)} onChange={() => { editingDependencies.current = true; setExtraIds((old) => old.includes(item.id) ? old.filter((id) => id !== item.id) : [...old, item.id]); }} />{item.title}{fixed.has(item.id) ? ' · Teilkarte' : ''}</label>)}
          {!candidates.length ? <p className="field-help">Lege zuerst weitere aktive Karten im Projekt an.</p> : null}
          <button className="secondary-button" type="submit" disabled={busy || extraIds.length + fixed.size > 8}>Vorgänger speichern</button>
        </form>
      </details>
      {gate.dependencies.length ? <ul>{gate.dependencies.map((item) => <li key={item.prerequisiteCardId}>
        <strong>{item.prerequisiteTitle}</strong> · {item.status === 'workflow' ? 'Workflow-Ergebnis belegt' : item.status === 'approved' ? `QA-Freigabe: ${item.approvalNote}` : 'Wartet auf Ergebnis oder QA-Freigabe'}
      </li>)}</ul> : null}
      {selected ? <form className="stacked-form" onSubmit={(event) => void approve(event)}>
        {blockedWithQa.length > 1 ? <label className="field-label">Vorgänger<select value={selected.prerequisiteCardId} onChange={(event) => { setDependencyId(event.target.value); setReportId(''); }}>
          {blockedWithQa.map((item) => <option key={item.prerequisiteCardId} value={item.prerequisiteCardId}>{item.prerequisiteTitle}</option>)}
        </select></label> : null}
        <label className="field-label">Bestandenen QA-Bericht auswählen<select required value={reportId} onChange={(event) => setReportId(event.target.value)}><option value="">Bericht wählen</option>{selected.reports.map((report) => <option key={report.id} value={report.id}>{new Date(report.endedAt).toLocaleString('de-DE')} · {report.id.slice(0, 8)}</option>)}</select></label>
        <label className="field-label">Warum darf die nächste Karte starten?<textarea required minLength={10} maxLength={1000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="secondary-button" type="submit" disabled={busy || !reportId || note.trim().length < 10}>Vorgänger bewusst freigeben</button>
      </form> : null}
      {gate.blockers.map((blocker) => <p className="inline-note" key={blocker}>{blocker}</p>)}
      <p className="field-help">Parallele Agenten brauchen getrennte Git-Worktrees. Eine Freigabe startet keinen Agenten.</p>
    </> : <p role="status" className="inline-note">Startbedingungen werden geprüft…</p>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
