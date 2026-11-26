import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentQuestion, AgentQuestionSuggestion } from '../../shared/agent-questions';
import { suggestAgentQuestionGroups } from '../../shared/agent-question-suggestions';
import { useVisibleInboxRefresh } from '../inbox-refresh';
import { notifyInboxChanged } from '../decision-navigation';

function status(question: AgentQuestion): string {
  if (question.delivery === 'delivered') return 'An diese Sitzung zugestellt · Übernahme nicht belegt';
  if (question.delivery === 'prepared') return 'Antwort gespeichert · Zustellung ungeklärt';
  if (question.delivery === 'stale') return 'Antwort gespeichert · Sitzung oder Karte inzwischen geändert';
  if (question.delivery === 'failed') return 'Antwort gespeichert · Zustellung fehlgeschlagen';
  if (question.cardArchived) return 'Karte archiviert · nicht zustellbar';
  if (question.sessionState !== 'running') return 'Sitzung beendet · nicht zustellbar';
  if (question.currentRevision !== question.cardRevision) return 'Karte geändert · nicht zustellbar';
  if (!question.receivable) return 'Neuere Kartensitzung · nicht zustellbar';
  return 'Offene Agentenfrage';
}

export function AgentQuestionSuggestionList({ questions, suggestions, disabled, onSelect }: {
  questions: AgentQuestion[]; suggestions: AgentQuestionSuggestion[]; disabled: boolean;
  onSelect: (questionIds: string[]) => void;
}) {
  if (!suggestions.length) return null;
  return <div className="agent-question-suggestions" aria-label="Ähnliche Fragen vorschlagen"><h4>Ähnliche offene Fragen</h4><p>Wortlaut-Hinweise, keine gemeinsame Entscheidung. Prüfe Geltungsbereich und Empfänger vor einer Antwort.</p>{suggestions.map((suggestion) => <div className="agent-question-suggestion" key={suggestion.questionIds.join(':')}>
    <div><strong>{suggestion.questionIds.length} Fragen aus {suggestion.questionIds.length} Karten</strong><small>Gemeinsame Begriffe: {suggestion.commonTerms.join(', ')}</small><ul>{suggestion.questionIds.map((id) => { const item = questions.find((question) => question.id === id)!; return <li key={id}>{item.cardTitle}: {item.question}</li>; })}</ul></div>
    <button type="button" className="decision-subaction" disabled={disabled} onClick={() => onSelect(suggestion.questionIds)}>Empfänger prüfen</button>
  </div>)}</div>;
}

export function AgentQuestions({ projectId, onOpenCard, onOpenSession }: {
  projectId: string; onOpenCard: (cardId: string) => void; onOpenSession: (sessionId: string) => void;
}) {
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const polling = useRef(false);
  const composeRef = useRef<HTMLDivElement>(null);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;

  useEffect(() => {
    let active = true;
    setQuestions([]); setSelected([]); setAnswer(''); setLoading(true); setError(''); setNotice('');
    void window.studio.agentQuestions(projectId).then((items) => { if (active) { setQuestions(items); setLoading(false); } },
      (reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); } });
    return () => { active = false; };
  }, [projectId]);

  async function refresh(quiet = false) {
    if (polling.current || busy) return;
    polling.current = true;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const items = await window.studio.agentQuestions(projectId);
      if (activeProject.current !== projectId) return;
      setQuestions(items);
      setSelected((previous) => previous.filter((id) => items.some((item) => item.id === id && item.receivable)));
    } catch (reason) { if (activeProject.current === projectId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { polling.current = false; if (!quiet && activeProject.current === projectId) setLoading(false); }
  }

  useVisibleInboxRefresh(() => { void refresh(true); });

  async function sendAnswer() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const picked = selected.map((id) => questions.find((item) => item.id === id)!);
      await window.studio.answerAgentQuestions({ projectId, questionIds: selected,
        expectedRevisions: Object.fromEntries(picked.map((item) => [item.id, item.cardRevision])), answer });
      setAnswer(''); setSelected([]);
      const items = await window.studio.agentQuestions(projectId);
      setQuestions(items);
      notifyInboxChanged();
      setNotice('Eine Antwort gespeichert. Prüfe den Zustellstatus pro Frage; die inhaltliche Übernahme ist dadurch noch nicht belegt.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const suggestions = useMemo(() => suggestAgentQuestionGroups(questions), [questions]);
  const picked = selected.map((id) => questions.find((item) => item.id === id)).filter((item): item is AgentQuestion => Boolean(item));
  const canSend = picked.length >= 1 && picked.every((item) => item.receivable)
    && (picked.length === 1 || new Set(picked.map((item) => item.cardId)).size >= 2)
    && Boolean(answer.trim()) && !busy;
  return <section className="agent-questions" aria-label="Agentenfragen">
    <div className="agent-questions-heading"><div><h3>Agentenfragen</h3><p>Fragen aus echten Karten-Sitzungen. Antworte auf eine Frage oder wähle mehrere Karten für eine gemeinsame Antwort.</p></div>
      <button className="decision-subaction" type="button" disabled={loading || busy} onClick={() => void refresh()}>Aktualisieren</button></div>
    {loading ? <p role="status">Fragen werden geladen…</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
    {!loading && !questions.length ? <p className="section-copy">Noch keine Agentenfragen gespeichert. Ein laufender Agent kann eine Rückfrage über das lokale Fragetool stellen.</p> : null}
    <AgentQuestionSuggestionList questions={questions} suggestions={suggestions} disabled={busy || loading} onSelect={(ids) => { setSelected(ids.filter((id) => questions.some((item) => item.id === id && item.receivable))); requestAnimationFrame(() => composeRef.current?.scrollIntoView({ block: 'nearest' })); }} />
    {questions.length ? <div className="agent-question-list">{questions.map((item) => {
      const eligible = item.receivable;
      return <article className="agent-question-row" key={item.id} data-agent-question-id={item.id}>
        <label className="agent-question-choice"><input type="checkbox" checked={selected.includes(item.id)} disabled={!eligible || busy}
          onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
          <span><strong>{item.question}</strong><small>{item.cardTitle} · {item.agentName} · Auftragsrevision {item.cardRevision} · {status(item)}</small></span></label>
        <div className="agent-question-links">{eligible ? <button type="button" className="decision-subaction" disabled={busy}
          onClick={() => { setSelected([item.id]); requestAnimationFrame(() => composeRef.current?.scrollIntoView({ block: 'nearest' })); }}>Antworten</button> : null}
          <button type="button" className="decision-subaction" onClick={() => onOpenCard(item.cardId)}>Karte</button><button type="button" className="decision-subaction" onClick={() => onOpenSession(item.sessionId)}>Sitzung</button></div>
        {item.answer ? <p className="agent-question-answer"><strong>Deine gemeinsame Antwort:</strong> {item.answer}{item.deliveryNote ? ` · ${item.deliveryNote}` : ''}</p> : null}
      </article>;
    })}</div> : null}
    {selected.length ? <div ref={composeRef} className="agent-question-compose"><p>{picked.length} Empfänger · {new Set(picked.map((item) => item.cardId)).size} Karten. Prüfe jede ursprüngliche Frage vor der gemeinsamen Antwort.</p><ul className="agent-question-recipients">{picked.map((item) => <li key={item.id}><span><strong>{item.cardTitle}</strong> · Revision {item.cardRevision}<br />{item.question}</span><button type="button" className="decision-subaction" disabled={busy} aria-label={`Frage von ${item.cardTitle} abwählen`} onClick={() => setSelected((current) => current.filter((id) => id !== item.id))}>Abwählen</button></li>)}</ul>
      <label>Gemeinsame Antwort<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={4_000} rows={3} placeholder="Entscheidung für die ausgewählten Fragen…" /></label>
      <button className="primary-button" type="button" disabled={!canSend} onClick={() => void sendAnswer()}>{busy ? 'Speichert und stellt zu…' : picked.length === 1 ? 'Antwort senden' : 'Einmal beantworten'}</button>
    </div> : null}
  </section>;
}
