import { useEffect, useMemo, useState } from 'react';
import type { ComponentCandidate, ComponentCatalog } from '../../shared/component-catalog';
import type { CardComponentChoiceState } from '../../shared/card-component-choice';
import './card-component-choice.css';

interface Props { cardId: string; projectId: string; archived: boolean }
const reasonText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function CardComponentChoicePanel({ cardId, projectId, archived }: Props) {
  const [state, setState] = useState<CardComponentChoiceState | null>(null);
  const [catalog, setCatalog] = useState<ComponentCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ComponentCandidate | null>(null);
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setState(null); setCatalog(null); setChosen(null); setPurpose(''); setQuery(''); setError('');
    void window.studio.cardComponentChoiceState(cardId).then((result) => { if (live) setState(result); })
      .catch((reason: unknown) => { if (live) setError(reasonText(reason)); });
    return () => { live = false; };
  }, [cardId]);

  async function search() {
    setBusy(true); setError(''); setChosen(null);
    try { setCatalog(await window.studio.componentCatalog(projectId)); }
    catch (reason) { setCatalog(null); setError(reasonText(reason)); }
    finally { setBusy(false); }
  }

  async function add() {
    if (!chosen || !state) return;
    setBusy(true); setError('');
    try {
      setState(await window.studio.addCardComponentChoice({ cardId, expectedContentRevision: state.contentRevision,
        name: chosen.name, path: chosen.path, line: chosen.line, sourceFingerprint: chosen.sourceFingerprint, purpose }));
      setChosen(null); setPurpose('');
    } catch (reason) {
      setError(reasonText(reason));
      setState(await window.studio.cardComponentChoiceState(cardId));
    } finally { setBusy(false); }
  }

  async function remove(choiceId: string) {
    if (!state) return;
    setBusy(true); setError('');
    try { setState(await window.studio.removeCardComponentChoice({ cardId, choiceId, expectedContentRevision: state.contentRevision })); }
    catch (reason) { setError(reasonText(reason)); setState(await window.studio.cardComponentChoiceState(cardId)); }
    finally { setBusy(false); }
  }

  const candidates = useMemo(() => catalog?.candidates.filter((candidate) =>
    `${candidate.name} ${candidate.path}`.toLocaleLowerCase('de-DE').includes(query.trim().toLocaleLowerCase('de-DE'))) ?? [], [catalog, query]);
  const selected = state?.choices ?? [];
  return <details className="card-component-choice" aria-label="Komponentenreferenzen">
    <summary>Komponentenreferenzen <span>{selected.length ? `${selected.length} gewählt` : 'aus dem Projekt wählen'}</span></summary>
    <div className="card-component-choice__body">
      <p>Wähle vorhandene TSX-/JSX-Exporte für diesen Auftrag. Der Agent erhält Dateipfad, Verwendungshinweis und geprüften Quellstand. Projektcode wird für diese Auswahl nicht ausgeführt.</p>
      {error ? <p role="alert" className="inline-error">{error}</p> : null}
      {selected.length ? <ul className="card-component-choice__selected">{selected.map((choice) => <li key={choice.id}>
        <div><strong>{choice.name}</strong><code>{choice.path}:{choice.line}</code><small>{choice.purpose || 'Ohne Verwendungshinweis'} · {choice.current ? `Quelle geprüft · ${choice.sourceFingerprint.slice(0, 12)}` : 'Quelle geändert oder nicht verfügbar · erneut auswählen'}</small></div>
        <button type="button" className="text-button" disabled={busy || archived} onClick={() => void remove(choice.id)}>Lösen</button>
      </li>)}</ul> : <p className="card-component-choice__empty">Noch keine Komponente verbunden.</p>}
      <button type="button" className="secondary-button" disabled={busy || archived || selected.length >= 6} onClick={() => void search()}>{busy ? 'Prüfe…' : catalog ? 'Quellen erneut suchen' : 'Quellen suchen'}</button>
      {catalog ? <><p className="card-component-choice__meta">{catalog.candidates.length} Kandidaten aus {catalog.scannedFiles} Dateien{catalog.partial ? ' · Inventur unvollständig' : ''}</p>
        {catalog.notes.length ? <p className="card-component-choice__meta">{catalog.notes.join(' ')}</p> : null}
        <label className="card-component-choice__filter">Filtern<input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder Pfad" /></label>
        <ul className="card-component-choice__candidates">{candidates.slice(0, 40).map((candidate) => <li key={`${candidate.path}:${candidate.name}:${candidate.line}`}>
          <button type="button" disabled={busy || archived || selected.some((item) => item.path === candidate.path && item.name === candidate.name)} onClick={() => { setChosen(candidate); setPurpose(''); }} aria-pressed={chosen?.path === candidate.path && chosen.name === candidate.name}>
            <strong>{candidate.name}</strong><code>{candidate.path}:{candidate.line}</code>
          </button>
        </li>)}</ul>
        {candidates.length > 40 ? <p className="card-component-choice__meta">Nur 40 Treffer sichtbar. Filtere nach Name oder Pfad.</p> : null}
        {chosen ? <div className="card-component-choice__confirm"><p><strong>{chosen.name}</strong> aus <code>{chosen.path}:{chosen.line}</code></p><label>Verwendungshinweis<input maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Zum Beispiel: Dialog für Einstellungen" /></label><button type="button" disabled={busy || archived || !state || purpose.trim().length < 3} onClick={() => void add()}>Referenz übernehmen</button></div> : null}
      </> : null}
      <p className="card-component-choice__meta">Die Inventur belegt Exportnamen und Dateien, keine gerenderte Vorschau oder die sichere Verwendbarkeit beliebiger Props.</p>
    </div>
  </details>;
}
