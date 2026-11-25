import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/types';
import type { CardCriterion } from '../../shared/card-acceptance';
import type { RequirementConflictBoard, RequirementConflictSuggestion, RequirementStance } from '../../shared/requirement-conflicts';
import './requirement-conflicts.css';

interface Props { projectId: string; cards: Card[]; onOpenCard: (cardId: string) => void }
type DecisionDraft = { pairKey: string; choice: string; reason: string };
const errorText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function RequirementSuggestionList({ suggestions, limited, busy, onSelect, onOpenCard }: {
  suggestions: RequirementConflictSuggestion[]; limited: boolean; busy: boolean;
  onSelect: (item: RequirementConflictSuggestion) => void; onOpenCard: (cardId: string) => void;
}) {
  return <div className="requirement-conflicts__suggestions" aria-label="Mögliche neue Regelkonflikte">
    <h4>Neue Wortlaut-Hinweise · {suggestions.length}</h4>
    {suggestions.length ? <p>Nur Sätze mit gleichem Wortlaut außer einer ausdrücklich gegensätzlichen Muss-Formulierung erscheinen. Bauteil, Bereich und Merkmal stammen aus der bereits markierten Regel und müssen noch geprüft werden.</p> : <p>Keine neuen Wortlaut-Hinweise aus den aktuellen Abnahmekriterien.</p>}
    {suggestions.map((item) => <article key={`${item.criterionId}:${item.source.id}`}>
      <div className="requirement-conflicts__meta"><span>{item.source.component} · {item.source.property}</span><span>Vermuteter Bereich: {item.source.scope}</span></div>
      <div className="requirement-conflicts__pair"><div><button type="button" className="requirement-conflicts__card-link" onClick={() => onOpenCard(item.cardId)}>{item.cardTitle}</button><p>„{item.statement}“</p><small>Neues Kriterium · Kartenstand {item.cardRevision} · {item.proposedStance === 'required' ? 'muss' : 'darf nicht'} (Wortlaut)</small></div>
        <div><button type="button" className="requirement-conflicts__card-link" onClick={() => onOpenCard(item.source.cardId)}>{item.source.cardTitle}</button><p>„{item.source.statement}“</p><small>Markierte Quelle · Kartenstand {item.source.cardRevision} · {item.source.stance === 'required' ? 'muss' : 'darf nicht'}</small></div></div>
      <p>Grund: Gleicher Satz nach Entfernen genau einer gegensätzlichen Muss-Formulierung. Unsicher: Die beiden Sätze können unterschiedliche Situationen meinen; der vorhandene Schlüssel ist keine Textanalyse.</p>
      <button type="button" className="decision-subaction" disabled={busy} onClick={() => onSelect(item)}>Regelmarkierung prüfen</button>
    </article>)}
    {limited ? <small>Die Suche war begrenzt. Weitere Kriterien oder Hinweise können fehlen.</small> : null}
  </div>;
}

export function RequirementConflictsPanel({ projectId, cards, onOpenCard }: Props) {
  const activeCards = cards.filter((card) => !card.archivedAt);
  const [board, setBoard] = useState<RequirementConflictBoard | null>(null);
  const [cardId, setCardId] = useState(activeCards[0]?.id ?? '');
  const [criteria, setCriteria] = useState<CardCriterion[]>([]);
  const [criterionId, setCriterionId] = useState('');
  const [component, setComponent] = useState('');
  const [scope, setScope] = useState('');
  const [property, setProperty] = useState('');
  const [stance, setStance] = useState<RequirementStance>('required');
  const [decision, setDecision] = useState<DecisionDraft | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<RequirementConflictSuggestion | null>(null);
  const setupRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let live = true; setBoard(null); setError(''); setDecision(null); setSelectedSuggestion(null); setCardId(activeCards[0]?.id ?? '');
    void window.studio.requirementConflictBoard(projectId).then((value) => { if (live) setBoard(value); }).catch((reason: unknown) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [projectId]);
  useEffect(() => {
    if (!cardId) { setCriteria([]); setCriterionId(''); return; }
    let live = true;
    void window.studio.cardCriteria(cardId).then((value) => { if (live) { setCriteria(value); setCriterionId((previous) => value.some((item) => item.id === previous) ? previous : value[0]?.id ?? ''); } })
      .catch((reason: unknown) => { if (live) { setCriteria([]); setCriterionId(''); setError(errorText(reason)); } });
    return () => { live = false; };
  }, [cardId, projectId]);
  async function reloadHints() {
    setBusy(true); setError('');
    try { setBoard(await window.studio.requirementConflictBoard(projectId)); if (cardId) setCriteria(await window.studio.cardCriteria(cardId)); setSelectedSuggestion(null); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }
  function inspectSuggestion(item: RequirementConflictSuggestion) {
    setCardId(item.cardId); setCriterionId(item.criterionId); setComponent(item.source.component); setScope(item.source.scope);
    setProperty(item.source.property); setStance(item.proposedStance); setSelectedSuggestion(item); setError('');
    if (setupRef.current) setupRef.current.open = true;
  }
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!board || !cardId || !criterionId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setBoard(await window.studio.addRequirementClaim({ projectId, cardId, criterionId, component, scope, property, stance,
        expectedCardRevision: selectedSuggestion?.cardRevision ?? board.cardRevisions[cardId] ?? -1,
        expectedCriterionText: criteria.find((item) => item.id === criterionId)?.text,
        suggestionEvidence: selectedSuggestion ? { sourceClaimId: selectedSuggestion.source.id,
          sourceStatement: selectedSuggestion.source.statement, sourceCardRevision: selectedSuggestion.source.cardRevision } : undefined }));
      setSelectedSuggestion(null);
      setNotice('Regelmarkierung gespeichert. Originalkriterium unverändert.');
    } catch (reason) { setError(errorText(reason)); setBoard(await window.studio.requirementConflictBoard(projectId)); }
    finally { setBusy(false); }
  }
  async function refresh(claimId: string, sourceCardId: string) {
    if (!board) return; setBusy(true); setError(''); setNotice('');
    try { setBoard(await window.studio.refreshRequirementClaim({ projectId, claimId, expectedCardRevision: board.cardRevisions[sourceCardId] ?? -1 })); setNotice('Quellstand erneut übernommen. Frühere Entscheidungen bleiben im Verlauf.'); }
    catch (reason) { setError(errorText(reason)); setBoard(await window.studio.requirementConflictBoard(projectId)); }
    finally { setBusy(false); }
  }
  async function remove(claimId: string) {
    setBusy(true); setError(''); setNotice('');
    try { setBoard(await window.studio.removeRequirementClaim({ projectId, claimId })); setNotice('Regelmarkierung entfernt. Vorherige Entscheidungen bleiben im Verlauf.'); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }
  async function resolve(event: React.FormEvent<HTMLFormElement>, pairKey: string, fingerprint: string) {
    event.preventDefault(); if (!decision || decision.pairKey !== pairKey) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setBoard(await window.studio.resolveRequirementConflict({ projectId, pairKey, fingerprint, status: decision.choice === 'dismissed' ? 'dismissed' : 'chosen',
        winnerClaimId: decision.choice === 'dismissed' ? null : decision.choice, reason: decision.reason }));
      setDecision(null); setNotice('Entscheidung an beiden Kartenständen gespeichert.');
    } catch (reason) { setError(errorText(reason)); setBoard(await window.studio.requirementConflictBoard(projectId)); }
    finally { setBusy(false); }
  }
  return <section className="requirement-conflicts" aria-label="Widersprüchliche Anforderungen">
    <div className="requirement-conflicts__intro"><h3>Widersprüchliche Anforderungen</h3><p>Markiere konkrete Abnahmekriterien mit Bauteil, Geltungsbereich und Merkmal. Nur entgegengesetzte Regeln mit genau diesem gemeinsamen Schlüssel erscheinen als Hinweis.</p></div>
    {board ? <><RequirementSuggestionList suggestions={board.suggestions} limited={board.suggestionsLimited} busy={busy} onSelect={inspectSuggestion} onOpenCard={onOpenCard} /><button type="button" className="text-button" disabled={busy} onClick={() => void reloadHints()}>Hinweise aktualisieren</button></> : null}
    <details ref={setupRef} className="requirement-conflicts__setup"><summary>Regel aus einer Karte markieren</summary><form onSubmit={(event) => void add(event)}>
      <label>Karte<select value={cardId} onChange={(event) => { setCardId(event.target.value); setSelectedSuggestion(null); }}>{activeCards.map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label>
      <label>Originalaussage<select value={criterionId} onChange={(event) => { setCriterionId(event.target.value); setSelectedSuggestion(null); }}>{criteria.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label>
      {selectedSuggestion ? <p className="requirement-conflicts__prefill">Aus Wortlaut-Hinweis vorbelegt. Prüfe den vermuteten Bereich und beide Originalaussagen oben. Erst „Regel markieren“ speichert diese Klassifikation.</p> : null}
      {!criteria.length ? <p>Auf dieser Karte zuerst ein Abnahmekriterium erfassen.</p> : null}
      <div className="requirement-conflicts__keys"><label>Bauteil<input required maxLength={80} value={component} onChange={(event) => { setComponent(event.target.value); setSelectedSuggestion(null); }} placeholder="Navigation" /></label><label>Geltungsbereich<input required maxLength={120} value={scope} onChange={(event) => { setScope(event.target.value); setSelectedSuggestion(null); }} placeholder="Mobile bis 768 px" /></label><label>Merkmal<input required maxLength={80} value={property} onChange={(event) => { setProperty(event.target.value); setSelectedSuggestion(null); }} placeholder="Sichtbarkeit" /></label><label>Vorgabe<select value={stance} onChange={(event) => { setStance(event.target.value as RequirementStance); setSelectedSuggestion(null); }}><option value="required">Muss gelten</option><option value="forbidden">Darf nicht gelten</option></select></label></div>
      <button type="submit" className="secondary-button" disabled={busy || !criterionId || !criteria.some((item) => item.id === criterionId) || !board}>Regel markieren</button>
    </form></details>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}{notice ? <p className="inline-note" role="status">{notice}</p> : null}
    {board ? <><div className="requirement-conflicts__list"><h4>Hinweise</h4>
      {board.conflicts.length ? board.conflicts.map((item) => <article key={item.pairKey} className="requirement-conflicts__item">
        <div className="requirement-conflicts__meta"><span>{item.component} · {item.property}</span><span>{item.scope}</span><span>{item.decision?.current ? item.decision.status === 'chosen' ? 'Entschieden' : 'Begründet verworfen' : item.current ? 'Offen' : 'Quellenstand veraltet'}</span></div>
        <div className="requirement-conflicts__pair">{[item.left, item.right].map((claim) => <div key={claim.id}><button type="button" className="requirement-conflicts__card-link" onClick={() => onOpenCard(claim.cardId)}>{claim.cardTitle}</button><p>„{claim.statement}“</p><small>{claim.stance === 'required' ? 'Muss gelten' : 'Darf nicht gelten'} · Kartenstand {claim.cardRevision}{claim.current ? '' : ' · verändert'}</small></div>)}</div>
        <p className="requirement-conflicts__why">Vermuteter Widerspruch: derselbe Bauteil, Geltungsbereich und dasselbe Merkmal erhalten gegensätzliche Vorgaben.</p>
        {item.decision?.current ? <p className="requirement-conflicts__resolution">{item.decision.status === 'chosen' ? `Es gilt die Regel aus ${item.left.id === item.decision.winnerClaimId ? item.left.cardTitle : item.right.cardTitle}.` : 'Hinweis verworfen: unterschiedliche Situationen.'} {item.decision.reason}</p> : null}
        {!item.decision && item.current ? decision?.pairKey === item.pairKey ? <form className="requirement-conflicts__resolve" onSubmit={(event) => void resolve(event, item.pairKey, item.fingerprint)}><label>Entscheidung<select value={decision.choice} onChange={(event) => setDecision({ ...decision, choice: event.target.value })}><option value={item.left.id}>{item.left.cardTitle} gilt</option><option value={item.right.id}>{item.right.cardTitle} gilt</option><option value="dismissed">Unterschiedliche Situationen</option></select></label><label>Begründung<input required maxLength={500} value={decision.reason} onChange={(event) => setDecision({ ...decision, reason: event.target.value })} /></label><button type="submit" disabled={busy || !decision.reason.trim()}>Entscheidung speichern</button><button type="button" onClick={() => setDecision(null)}>Abbrechen</button></form>
          : <button type="button" className="decision-subaction" onClick={() => setDecision({ pairKey: item.pairKey, choice: item.left.id, reason: '' })}>Hinweis entscheiden</button> : null}
      </article>) : <p className="requirement-conflicts__empty">Keine gegensätzlichen Regeln mit gleichem Schlüssel markiert.</p>}</div>
      <details className="requirement-conflicts__rules"><summary>Markierte Regeln · {board.claims.length}</summary>{board.claims.map((claim) => <div key={claim.id}><span>{claim.cardTitle}: {claim.statement}</span><small>{claim.component} · {claim.scope} · {claim.property} · {claim.stance === 'required' ? 'muss' : 'darf nicht'}{claim.current ? '' : ' · veraltet'}</small>{!claim.current ? <button type="button" disabled={busy} onClick={() => void refresh(claim.id, claim.cardId)}>Quellstand übernehmen</button> : null}<button type="button" disabled={busy} onClick={() => void remove(claim.id)}>Markierung entfernen</button></div>)}</details>
      <details className="requirement-conflicts__history"><summary>Entscheidungsverlauf · {board.decisionHistory.length}</summary>{board.decisionHistory.map((entry) => <div key={entry.id}><time dateTime={entry.decidedAt}>{new Date(entry.decidedAt).toLocaleString('de-DE')}</time><p>„{entry.leftStatement}“ / „{entry.rightStatement}“</p><small>Kartenstände {entry.leftCardRevision} und {entry.rightCardRevision} · {entry.current ? 'aktuell' : 'historisch'}</small><p>{entry.status === 'chosen' ? `Gewählte Regel: „${entry.winnerStatement}“` : 'Hinweis verworfen'}: {entry.reason}</p><button type="button" onClick={() => onOpenCard(entry.leftCardId)}>Erste Karte</button><button type="button" onClick={() => onOpenCard(entry.rightCardId)}>Zweite Karte</button></div>)}</details>
      {board.limited ? <p className="requirement-conflicts__limit">Nur die ersten 200 Regeln, 100 Hinweise und 500 Entscheidungen werden hier geprüft bzw. angezeigt.</p> : null}
    </> : <p role="status">Lade Regelmarkierungen…</p>}
  </section>;
}
