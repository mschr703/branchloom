import { useEffect, useState } from 'react';
import type { ApiContractCheck, ApiContractDraft, ApiContractOverview, ApiContractPreview } from '../../shared/api-contract';
import type { Card } from '../../shared/types';
import { ApiContractHttpPanel } from './ApiContractHttpPanel';
import './api-contract-panel.css';

const INITIAL: ApiContractDraft = {
  method: 'GET', path: '/api/items', response: 'array',
  fields: [{ name: 'id', type: 'string', required: true }, { name: 'title', type: 'string', required: true }],
  error: { status: 404, code: 'NOT_FOUND', message: 'Resource not found' },
};
interface Props { projectId: string; cards: Card[] }
const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function ApiContractPanel({ projectId, cards }: Props) {
  const [overview, setOverview] = useState<ApiContractOverview | null>(null);
  const [draft, setDraft] = useState<ApiContractDraft>(INITIAL);
  const [preview, setPreview] = useState<ApiContractPreview | null>(null);
  const [sampleText, setSampleText] = useState('');
  const [sampleStatus, setSampleStatus] = useState(200);
  const [check, setCheck] = useState<ApiContractCheck | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    setOverview(null); setPreview(null); setCheck(null); setDraft(INITIAL);
    void window.studio.apiContractOverview(projectId).then((value) => { if (live) { setOverview(value); if (value.versions[0]) setDraft(value.versions[0].draft); } }).catch((reason: unknown) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [projectId]);
  const latest = overview?.versions[0];
  const change = (next: ApiContractDraft) => { setDraft(next); setPreview(null); setCheck(null); setError(''); };
  async function showPreview() {
    setPending(true); setError('');
    try { setPreview(await window.studio.previewApiContract({ projectId, draft })); }
    catch (reason) { setError(message(reason)); }
    finally { setPending(false); }
  }
  async function save() {
    if (!preview) return;
    setPending(true); setError('');
    try {
      await window.studio.saveApiContract({ projectId, draft, fingerprint: preview.fingerprint, expectedLatestRevision: preview.expectedLatestRevision });
      setOverview(await window.studio.apiContractOverview(projectId)); setPreview(null); setCheck(null);
    } catch (reason) { setError(message(reason)); setPreview(null); }
    finally { setPending(false); }
  }
  async function bind(cardId: string, revision: number | null) {
    if (!overview) return;
    setPending(true); setError('');
    try {
      setOverview(await window.studio.bindCardApiContract({ projectId, cardId, revision, expectedContentRevision: overview.cardRevisions[cardId] ?? -1 }));
    } catch (reason) { setError(message(reason)); setOverview(await window.studio.apiContractOverview(projectId)); }
    finally { setPending(false); }
  }
  async function verify() {
    if (!latest) return;
    setPending(true); setError('');
    try { setCheck(await window.studio.checkApiContractResponse({ projectId, revision: latest.revision, status: sampleStatus, responseText: sampleText })); }
    catch (reason) { setError(message(reason)); setCheck(null); }
    finally { setPending(false); }
  }
  return <section className="api-contract" aria-label="Gemeinsamer API-Vertrag">
    <div className="api-contract__head"><div><p className="api-contract__eyebrow">ZUSAMMENARBEIT</p><h3>Gemeinsamer API-Vertrag</h3><p>Ein Endpoint für Frontend- und Backend-Karten. Erst prüfen, dann als Revision speichern und Karten gezielt zuordnen.</p></div>{latest ? <span className="api-contract__revision">Revision {latest.revision}</span> : null}</div>
    <div className="api-contract__editor">
      <label>Pfad <span>GET</span><input value={draft.path} onChange={(event) => change({ ...draft, path: event.target.value })} placeholder="/api/items" /></label>
      <label>Antwort<select value={draft.response} onChange={(event) => change({ ...draft, response: event.target.value as ApiContractDraft['response'] })}><option value="object">Objekt</option><option value="array">Liste von Objekten</option></select></label>
      <div className="api-contract__fields"><div className="api-contract__row-head"><strong>Antwortfelder</strong><button type="button" onClick={() => change({ ...draft, fields: [...draft.fields, { name: '', type: 'string', required: true }] })} disabled={draft.fields.length >= 16}>Feld hinzufügen</button></div>
        {draft.fields.map((field, index) => <div className="api-contract__field" key={index}><input aria-label={`Name von Feld ${index + 1}`} value={field.name} onChange={(event) => change({ ...draft, fields: draft.fields.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} placeholder="fieldName" /><select aria-label={`Typ von Feld ${index + 1}`} value={field.type} onChange={(event) => change({ ...draft, fields: draft.fields.map((item, i) => i === index ? { ...item, type: event.target.value as typeof item.type } : item) })}><option value="string">Text</option><option value="number">Zahl</option><option value="boolean">Ja/Nein</option></select><label><input type="checkbox" checked={field.required} onChange={(event) => change({ ...draft, fields: draft.fields.map((item, i) => i === index ? { ...item, required: event.target.checked } : item) })} /> Pflicht</label><button type="button" aria-label={`Feld ${index + 1} entfernen`} onClick={() => change({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}>×</button></div>)}
      </div>
      <div className="api-contract__error-case"><strong>Fehlerfall</strong><label>Status<input type="number" min={400} max={599} value={draft.error.status} onChange={(event) => change({ ...draft, error: { ...draft.error, status: Number(event.target.value) } })} /></label><label>Code<input value={draft.error.code} onChange={(event) => change({ ...draft, error: { ...draft.error, code: event.target.value } })} /></label><label>Meldung<input value={draft.error.message} onChange={(event) => change({ ...draft, error: { ...draft.error, message: event.target.value } })} /></label></div>
      <div className="api-contract__actions"><button type="button" onClick={() => void showPreview()} disabled={pending}>Vorschau prüfen</button>{preview ? <button type="button" onClick={() => void save()} disabled={pending}>Revision {preview.expectedLatestRevision + 1} speichern</button> : null}</div>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {preview ? <div className="api-contract__preview"><div><strong>Lokale Beispielantwort · 200</strong><pre>{JSON.stringify(preview.example, null, 2)}</pre></div><div><strong>Fehler · {preview.draft.error.status}</strong><pre>{JSON.stringify(preview.errorExample, null, 2)}</pre></div><small>SHA-256 {preview.fingerprint.slice(0, 16)}… · Statisches Beispiel, kein laufender Server.</small></div> : null}
    {latest ? <><div className="api-contract__section"><h4>Karten mit dieser Revision</h4><p>Gebundene Karten erhalten denselben Vertrag im Agentenauftrag. Alte Bindungen blockieren neue Starts.</p><div className="api-contract__cards">{cards.filter((card) => !card.archivedAt).map((card) => { const binding = overview?.bindings.find((item) => item.cardId === card.id); return <div key={card.id}><span>{card.title}</span><small>{binding ? `Revision ${binding.revision}${binding.current ? '' : ' · veraltet'}` : 'Nicht verbunden'}</small><button type="button" disabled={pending} onClick={() => void bind(card.id, binding?.current ? null : latest.revision)}>{binding?.current ? 'Lösen' : 'Verbinden'}</button></div>; })}</div></div>
      <div className="api-contract__section"><h4>Antwort prüfen</h4><p>Füge eine JSON-Antwort ein. Der Check vergleicht Felder und Typen mit Revision {latest.revision}; er führt keinen Netzaufruf aus.</p><div className="api-contract__sample"><label>HTTP-Status<input type="number" value={sampleStatus} onChange={(event) => { setSampleStatus(Number(event.target.value)); setCheck(null); }} /></label><textarea aria-label="JSON-Antwort" value={sampleText} onChange={(event) => { setSampleText(event.target.value); setCheck(null); }} rows={4} placeholder={JSON.stringify(latest.example, null, 2)} /><button type="button" disabled={pending || !sampleText.trim()} onClick={() => void verify()}>Antwort prüfen</button></div>{check ? <div role="status" className="api-contract__result"><strong>{check.valid ? 'Vertrag erfüllt' : `${check.mismatches.length} Abweichung(en)`}</strong>{check.mismatches.map((item, index) => <p key={index}><code>{item.path}</code>: erwartet {item.expected}, gefunden {item.actual}</p>)}</div> : null}</div>
      <ApiContractHttpPanel key={`${projectId}:${latest.revision}`} projectId={projectId} contract={latest} />
      <details className="api-contract__history"><summary>Gespeicherte Revisionen · {overview?.versions.length ?? 0}</summary>{overview?.versions.map((item) => <p key={item.revision}>Revision {item.revision} · {item.draft.method} {item.draft.path} · {item.fingerprint.slice(0, 12)}… · {new Date(item.createdAt).toLocaleString('de-DE')}</p>)}</details></> : <p className="api-contract__empty">Noch kein Vertrag gespeichert.</p>}
  </section>;
}
