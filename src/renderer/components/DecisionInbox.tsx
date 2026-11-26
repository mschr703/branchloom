import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import type { ReviewInboxItem, ReviewInboxPage } from '../../shared/review-inbox';
import type { GlobalInboxItem } from '../../shared/global-inbox';
import { decisionItems, filterDecisionItems, type DecisionFilter } from '../decision-inbox';
import { CrossProjectInbox } from './CrossProjectInbox';
import { RequirementConflictsPanel } from './RequirementConflictsPanel';
import { AgentQuestions } from './AgentQuestions';
import { inboxFirstPageChanged, useVisibleInboxRefresh } from '../inbox-refresh';
import { notifyInboxChanged } from '../decision-navigation';
import '../decision-inbox.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenWorkflow: (id: string) => void;
  onOpenQueue: () => void;
  onOpenSession: (id: string) => void;
  onOpenCard: (id: string) => void;
  onOpenDiffComment: (cardId: string, commentId: string) => void;
  onOpenQaReport: (cardId: string, reportId: string) => void;
  onAcknowledgeSession: (id: string) => void;
  onOpenPlan: (id: string) => void;
  onOpenGlobalItem?: (item: GlobalInboxItem) => void;
}

function pauseTime(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ReviewInboxList({ items, hasMore, busy, loadingMore, onOpenPlan, onOpenDiffComment, onOpenQaReport, onOpenCard, onAcknowledge, onLoadMore }: {
  items: ReviewInboxItem[]; hasMore: boolean; busy: string | null; loadingMore: boolean;
  onOpenPlan: (id: string) => void; onOpenDiffComment: (cardId: string, commentId: string) => void; onOpenQaReport: (cardId: string, reportId: string) => void; onOpenCard: (id: string) => void;
  onAcknowledge: (item: ReviewInboxItem) => void; onLoadMore: () => void;
}) {
  return <section className="decision-review-section" aria-label="Reviews und Feedback"><h3>Reviews und Feedback</h3><p>Gespeicherte Review-Kommentare, Gastfeedback und fehlgeschlagene Seitenprüfungen. Einträge als gelesen zu markieren gibt keinen Schritt frei.</p>
    <div className="decision-list">{items.map((item) => <article className="decision-item decision-review-item" data-qa-report-id={item.kind === 'qa' ? item.id : undefined} key={`${item.kind}:${item.id}`}>
      <div className="decision-item-body"><div className="decision-meta"><span className="decision-kind">{item.kind === 'plan' ? 'Plan-Review' : item.kind === 'diff' ? 'Code-Review' : item.kind === 'guest' ? 'Gastfeedback' : item.qaStatus === 'failed' ? 'Browser-QA · Fehler' : 'Browser-QA · Abbruch'}</span><time dateTime={item.createdAt}>{pauseTime(item.createdAt)}</time></div>
        <h4>{item.sourceTitle}</h4><p className="decision-context">{item.location}</p><p>{item.body}</p></div>
      <div className="decision-actions"><button className="secondary-button" type="button" onClick={() => item.kind === 'plan' ? onOpenPlan(item.sourceId) : item.kind === 'diff' ? onOpenDiffComment(item.sourceId, item.id) : item.kind === 'guest' ? onOpenCard(item.sourceId) : onOpenQaReport(item.sourceId, item.id)}>{item.kind === 'plan' ? 'Plan öffnen' : item.kind === 'diff' ? 'Kommentar öffnen' : item.kind === 'guest' ? 'Karte öffnen' : 'Bericht öffnen'} <ArrowRight size={15} aria-hidden="true" /></button>
        <button className="decision-subaction" type="button" aria-label={`${item.kind === 'plan' ? 'Plan' : item.kind === 'diff' ? 'Diff' : item.kind === 'guest' ? 'Gastfeedback' : 'Browser-QA'}: ${item.location} als ${item.kind === 'guest' ? 'gelesen' : 'geprüft'} markieren`} disabled={Boolean(busy)} onClick={() => onAcknowledge(item)}>{busy === item.id ? 'Speichert…' : item.kind === 'guest' ? 'Als gelesen markieren' : 'Als geprüft markieren'}</button></div>
    </article>)}</div>{hasMore ? <div className="decision-review-more"><p>Weitere passende Einträge sind vorhanden.</p><button className="secondary-button" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Lade…' : 'Ältere Einträge laden'}</button></div> : null}
  </section>;
}

export function DecisionInbox({ snapshot, onOpenWorkflow, onOpenQueue, onOpenSession, onOpenCard, onOpenDiffComment, onOpenQaReport, onAcknowledgeSession, onOpenPlan, onOpenGlobalItem }: Props) {
  const [scope, setScope] = useState<'project' | 'all'>('project');
  const [category, setCategory] = useState<DecisionFilter>('all');
  const [query, setQuery] = useState('');
  const [reviewResult, setReviewResult] = useState<{ key: string; page: ReviewInboxPage } | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false);
  const [reviewNotice, setReviewNotice] = useState('');
  const [reviewUpdateAvailable, setReviewUpdateAvailable] = useState(false);
  const reviewPolling = useRef(false);
  const activeProject = useRef(snapshot.project.id);
  activeProject.current = snapshot.project.id;
  const reviewKey = `${snapshot.project.id}\0${query.trim()}`;
  const activeReviewKey = useRef(reviewKey);
  activeReviewKey.current = reviewKey;
  const reviewRevision = useRef(0);
  const reviews = reviewResult?.key === reviewKey ? reviewResult.page : null;
  useEffect(() => { setCategory('all'); setQuery(''); }, [snapshot.project.id]);
  useEffect(() => {
    if (scope === 'all') return;
    let active = true;
    const revision = ++reviewRevision.current;
    setReviewResult(null); setReviewError(''); setReviewNotice(''); setReviewBusy(null); setReviewLoadingMore(false); setReviewUpdateAvailable(false);
    const timer = setTimeout(() => { void window.studio.reviewInboxItems({ projectId: snapshot.project.id, query: query.trim() }).then((page) => { if (active && reviewRevision.current === revision) setReviewResult({ key: reviewKey, page }); },
      (reason: unknown) => { if (active) setReviewError(reason instanceof Error ? reason.message : String(reason)); });
    }, query.trim() ? 150 : 0);
    return () => { active = false; reviewRevision.current++; clearTimeout(timer); };
  }, [snapshot.project.id, query, scope]);
  const items = decisionItems(snapshot);
  const visible = filterDecisionItems(items, category, query);
  const visibleReviews = category === 'all' || category === 'review' ? reviews?.items ?? [] : [];
  const hasItems = items.length > 0 || Boolean(reviews?.items.length);
  useVisibleInboxRefresh(() => {
    if (scope !== 'project' || !reviews || reviewBusy || reviewLoadingMore || reviewUpdateAvailable || reviewPolling.current) return;
    const key = reviewKey;
    const revision = ++reviewRevision.current;
    reviewPolling.current = true;
    void window.studio.reviewInboxItems({ projectId: snapshot.project.id, query: query.trim() }).then((fresh) => {
      if (activeReviewKey.current !== key || reviewRevision.current !== revision) return;
      if (reviews.items.length > 100) {
        if (inboxFirstPageChanged(reviews.items, fresh.items)) setReviewUpdateAvailable(true);
      } else {
        setReviewResult({ key, page: fresh });
        setReviewUpdateAvailable(false);
      }
      setReviewError('');
    }).catch((reason: unknown) => { if (activeReviewKey.current === key && reviewRevision.current === revision) setReviewError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { reviewPolling.current = false; });
  });
  async function reloadReviews() {
    if (reviewBusy || reviewLoadingMore || reviewPolling.current) return;
    const key = reviewKey;
    const revision = ++reviewRevision.current;
    reviewPolling.current = true;
    setReviewError('');
    try {
      const page = await window.studio.reviewInboxItems({ projectId: snapshot.project.id, query: query.trim() });
      if (activeReviewKey.current === key && reviewRevision.current === revision) { setReviewResult({ key, page }); setReviewUpdateAvailable(false); }
    } catch (reason) { if (activeReviewKey.current === key && reviewRevision.current === revision) setReviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { reviewPolling.current = false; }
  }
  async function loadMore() {
    if (!reviews?.hasMore || reviewLoadingMore || reviewPolling.current) return;
    const key = reviewKey;
    const revision = ++reviewRevision.current;
    setReviewLoadingMore(true); setReviewError('');
    try {
      const next = await window.studio.reviewInboxItems({ projectId: snapshot.project.id, query: query.trim(), offset: reviews.items.length });
      if (activeReviewKey.current === key && reviewRevision.current === revision) setReviewResult({ key, page: { items: [...reviews.items, ...next.items], hasMore: next.hasMore } });
    } catch (reason) { if (activeReviewKey.current === key) setReviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (activeReviewKey.current === key) setReviewLoadingMore(false); }
  }
  async function acknowledge(item: ReviewInboxItem) {
    if (reviewBusy) return;
    const projectId = snapshot.project.id;
    const revision = ++reviewRevision.current;
    setReviewLoadingMore(false);
    setReviewBusy(item.id); setReviewError(''); setReviewNotice('');
    try {
      if (item.kind === 'guest') await window.studio.acknowledgeGuestInboxComment({ projectId, commentId: item.id });
      else if (item.kind === 'qa') await window.studio.acknowledgeQaInboxReport({ projectId, reportId: item.id });
      else await window.studio.acknowledgeReviewInboxComment({ projectId, kind: item.kind, commentId: item.id });
      const page = await window.studio.reviewInboxItems({ projectId, query: query.trim() });
      if (activeProject.current === projectId && activeReviewKey.current === reviewKey && reviewRevision.current === revision) { setReviewResult({ key: reviewKey, page }); setReviewUpdateAvailable(false); setReviewNotice(item.kind === 'qa' ? 'QA-Hinweis als geprüft markiert. Der Kartenbericht bleibt erhalten.' : item.kind === 'guest' ? 'Gastfeedback als gelesen markiert. Der Kommentar bleibt in den Projekteinstellungen erhalten.' : 'Kommentar als geprüft markiert. Der Originalkommentar bleibt an seiner Quelle.'); notifyInboxChanged(); }
    } catch (reason) { if (activeProject.current === projectId) setReviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (activeProject.current === projectId) setReviewBusy(null); }
  }

  return <div className="standard-page decision-page">
    <div className="view-header"><div><h2>Offene Entscheidungen</h2><p>{scope === 'all' ? 'Gespeicherte offene Hinweise aller lokalen Projekte. Jede Quelle ist einem Projekt zugeordnet.' : 'Gespeicherte Pausen, unterbrochene Agentenläufe, Reviews, Gastfeedback und Browser-QA aus dem aktiven Projekt. Öffne die Quelle vor einer Entscheidung.'}</p></div></div>
    {onOpenGlobalItem ? <div className="decision-scope" role="group" aria-label="Projektumfang"><button type="button" className="secondary-button" aria-pressed={scope === 'project'} onClick={() => setScope('project')}>Dieses Projekt</button><button type="button" className="secondary-button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Alle Projekte</button></div> : null}
    {scope === 'all' && onOpenGlobalItem ? <CrossProjectInbox onOpen={onOpenGlobalItem} /> : <>
    <RequirementConflictsPanel projectId={snapshot.project.id} cards={snapshot.cards} onOpenCard={onOpenCard} />
    <AgentQuestions projectId={snapshot.project.id} onOpenCard={onOpenCard} onOpenSession={onOpenSession} />
    {!reviews && !reviewError ? <p className="section-copy" role="status">Reviews und Feedback werden geladen…</p> : null}
    {reviewError ? <p className="inline-error" role="alert">Reviews und Feedback konnten nicht geladen werden: {reviewError}</p> : null}
    {reviewNotice ? <p className="inline-note" role="status">{reviewNotice}</p> : null}
    {reviewUpdateAvailable && scope === 'project' ? <p className="inline-note" role="status">Die ersten Inbox-Einträge haben sich geändert. <button type="button" className="decision-subaction" onClick={() => void reloadReviews()}>Liste aktualisieren</button></p> : null}
    {!hasItems && reviews && !query.trim() ? <div className="decision-empty"><Inbox size={24} aria-hidden="true" /><h3>Keine weiteren Pausen oder Reviews</h3><p>Hier erscheinen pausierte Workflows, angehaltene Warteschlangen, unterbrochene Agentenläufe, Review-Kommentare, Gastfeedback und fehlgeschlagene Browser-QA. Anforderungswidersprüche stehen darüber.</p></div>
      : <>
        {items.length + (reviews?.items.length ?? 0) > 4 || category !== 'all' || query ? <div className="decision-controls">
          <label>Entscheidung suchen<input type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workflow, Karte oder Grund" /></label>
          <label>Grund<select value={category} onChange={(event) => setCategory(event.target.value as DecisionFilter)}>
            <option value="all">Alle</option><option value="approval">Freigabe</option><option value="review">Prüfung</option><option value="manual">Manueller Schritt</option><option value="paused">Pausiert</option>
          </select></label>
        </div> : null}
        {visible.length === 0 && visibleReviews.length === 0 && reviews ? <p className="decision-no-match" role="status">Keine Entscheidung passt zur Suche. Passe Suchwort oder Grund an.</p>
          : visible.length ? <div className="decision-list" aria-label="Offene Entscheidungen">{visible.map((item) => <article className="decision-item" key={item.id}>
            <div className="decision-item-body">
              <div className="decision-meta"><span className="decision-kind">{item.kind === 'queue' ? 'Warteschlange' : item.kind === 'session' ? 'Agentenlauf' : 'Workflow'}</span>{pauseTime(item.updatedAt) ? <time dateTime={item.updatedAt ?? undefined}>Aktualisiert {pauseTime(item.updatedAt)}</time> : null}</div>
              <h3>{item.title}</h3><p>{item.reason}</p>{item.context ? <p className="decision-context">{item.context}</p> : null}
              <p className="decision-next"><strong>Nächster Schritt:</strong> {item.nextAction}</p>
            </div>
            <div className="decision-actions">
              <button className="secondary-button" type="button" onClick={() => { if (item.kind === 'queue') onOpenQueue(); else if (item.kind === 'session' && item.sessionId) onOpenSession(item.sessionId); else if (item.workflowId) onOpenWorkflow(item.workflowId); }}>{item.kind === 'queue' ? 'Zur Warteschlange' : item.kind === 'session' ? 'Verlauf prüfen' : 'Zum Workflow'} <ArrowRight size={15} aria-hidden="true" /></button>
              {item.kind === 'queue' && item.workflowId ? <button className="decision-subaction" type="button" onClick={() => onOpenWorkflow(item.workflowId!)}>Aktiven Workflow öffnen</button> : null}
              {item.kind === 'session' && item.cardId ? <button className="decision-subaction" type="button" onClick={() => onOpenCard(item.cardId!)}>Karte und Dateien öffnen</button> : null}
              {item.kind === 'session' && item.sessionId ? <button className="decision-subaction" type="button" onClick={() => onAcknowledgeSession(item.sessionId!)}>Prüfung abgeschlossen</button> : null}
            </div>
          </article>)}</div> : null}
        {visibleReviews.length ? <ReviewInboxList items={visibleReviews} hasMore={Boolean(reviews?.hasMore)} busy={reviewBusy} loadingMore={reviewLoadingMore}
          onOpenPlan={onOpenPlan} onOpenDiffComment={onOpenDiffComment} onOpenQaReport={onOpenQaReport} onOpenCard={onOpenCard} onAcknowledge={(item) => void acknowledge(item)} onLoadMore={() => void loadMore()} /> : null}
      </>}
    </>}
  </div>;
}
