import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import type { GlobalInboxCategory, GlobalInboxItem, GlobalInboxPage } from '../../shared/global-inbox';
import { inboxFirstPageChanged, useVisibleInboxRefresh } from '../inbox-refresh';

const label: Record<GlobalInboxItem['kind'], string> = {
  workflow: 'Workflow', queue: 'Warteschlange', session: 'Agentenlauf',
  plan: 'Plan-Review', diff: 'Code-Review', qa: 'Browser-QA', guest: 'Gastfeedback',
};
const reviewKind = (kind: GlobalInboxItem['kind']): kind is 'plan' | 'diff' | 'qa' | 'guest' => kind === 'plan' || kind === 'diff' || kind === 'qa' || kind === 'guest';
const errorText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

/** A separate, explicitly selected view. Every row carries its actual project identity. */
export function CrossProjectInbox({ onOpen }: { onOpen: (item: GlobalInboxItem) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GlobalInboxCategory>('all');
  const [page, setPage] = useState<GlobalInboxPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const generation = useRef(0);
  const polling = useRef(false);
  const currentKey = `${category}\0${query.trim()}`;
  const [resultKey, setResultKey] = useState('');
  const visiblePage = resultKey === currentKey ? page : null;

  useEffect(() => {
    const current = ++generation.current;
    setPage(null); setError(''); setNotice(''); setBusy(null); setLoadingMore(false); setUpdateAvailable(false);
    const timer = setTimeout(() => {
      void window.studio.globalInboxItems({ query: query.trim(), category }).then((result) => {
        if (generation.current === current) { setPage(result); setResultKey(currentKey); }
      }).catch((reason: unknown) => { if (generation.current === current) setError(errorText(reason)); });
    }, query.trim() ? 150 : 0);
    return () => { clearTimeout(timer); generation.current++; };
  }, [category, query]);

  useVisibleInboxRefresh(() => {
    if (!visiblePage || busy || loadingMore || updateAvailable || polling.current) return;
    const current = generation.current;
    polling.current = true;
    void window.studio.globalInboxItems({ query: query.trim(), category }).then((fresh) => {
      if (generation.current !== current) return;
      if (visiblePage.items.length > 100) {
        if (inboxFirstPageChanged(visiblePage.items, fresh.items)) setUpdateAvailable(true);
      } else {
        setPage(fresh);
        setUpdateAvailable(false);
      }
      setError('');
    }).catch((reason: unknown) => { if (generation.current === current) setError(errorText(reason)); })
      .finally(() => { polling.current = false; });
  });

  async function reload() {
    if (busy || loadingMore || polling.current) return;
    const current = ++generation.current;
    polling.current = true;
    setError('');
    try {
      const fresh = await window.studio.globalInboxItems({ query: query.trim(), category });
      if (generation.current === current) { setPage(fresh); setResultKey(currentKey); setUpdateAvailable(false); }
    } catch (reason) { if (generation.current === current) setError(errorText(reason)); }
    finally { polling.current = false; }
  }

  async function loadMore() {
    if (!visiblePage?.hasMore || loadingMore || busy || polling.current) return;
    const current = ++generation.current;
    setLoadingMore(true); setError('');
    try {
      const next = await window.studio.globalInboxItems({ query: query.trim(), category, offset: visiblePage.items.length });
      if (generation.current === current) setPage({ items: [...visiblePage.items, ...next.items], hasMore: next.hasMore, limitReached: next.limitReached });
    } catch (reason) { if (generation.current === current) setError(errorText(reason)); }
    finally { if (generation.current === current) setLoadingMore(false); }
  }

  async function acknowledge(item: GlobalInboxItem) {
    if (busy || !reviewKind(item.kind)) return;
    const current = ++generation.current;
    setBusy(item.id); setLoadingMore(false); setError(''); setNotice('');
    try {
      if (item.kind === 'guest') await window.studio.acknowledgeGuestInboxComment({ projectId: item.projectId, commentId: item.id.slice(6) });
      else if (item.kind === 'qa') await window.studio.acknowledgeQaInboxReport({ projectId: item.projectId, reportId: item.id.slice(3) });
      else await window.studio.acknowledgeReviewInboxComment({ projectId: item.projectId, kind: item.kind, commentId: item.id.slice(item.kind.length + 1) });
      const next = await window.studio.globalInboxItems({ query: query.trim(), category });
      if (generation.current === current) {
        setPage(next); setResultKey(currentKey);
        setUpdateAvailable(false);
        setNotice(item.kind === 'guest' ? 'Gastfeedback als gelesen markiert. Der Kommentar bleibt an der Karte.' : 'Eintrag lokal als geprüft markiert. Quelle und Workflow bleiben erhalten.');
      }
    } catch (reason) { if (generation.current === current) setError(errorText(reason)); }
    finally { if (generation.current === current) setBusy(null); }
  }

  return <section className="cross-project-inbox" aria-label="Entscheidungen aller Projekte">
    <p className="section-copy">Offene gespeicherte Hinweise aus allen lokalen Projekten. Öffne die Quelle im genannten Projekt; das allein startet oder genehmigt nichts.</p>
    <div className="decision-controls">
      <label>Entscheidung oder Projekt suchen<input type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projekt, Karte oder Grund" /></label>
      <label>Grund<select value={category} onChange={(event) => setCategory(event.target.value as GlobalInboxCategory)}><option value="all">Alle</option><option value="approval">Freigabe</option><option value="review">Prüfung</option><option value="manual">Manueller Schritt</option><option value="paused">Pausiert</option></select></label>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
    {updateAvailable ? <p className="inline-note" role="status">Die ersten Inbox-Einträge haben sich geändert. <button type="button" className="decision-subaction" onClick={() => void reload()}>Liste aktualisieren</button></p> : null}
    {!visiblePage && !error ? <p className="section-copy" role="status">Projektübergreifende Einträge werden geladen…</p> : null}
    {visiblePage?.items.length === 0 ? <div className="decision-empty"><Inbox size={24} aria-hidden="true" /><h3>Keine offenen Einträge</h3><p>Für diese Auswahl gibt es keine gespeicherten Pausen, Unterbrechungen, Review-Kommentare, Gastnachrichten oder fehlgeschlagenen Browser-QA-Berichte.</p></div> : null}
    {visiblePage?.items.length ? <div className="decision-list" aria-label="Offene Entscheidungen aller Projekte">{visiblePage.items.map((item) => <article className="decision-item" data-global-inbox-id={item.id} key={item.id}>
      <div className="decision-item-body">
        <div className="decision-meta"><span className="decision-kind">{label[item.kind]}</span><span className="decision-project">Projekt: {item.projectName}</span><time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString('de-DE')}</time></div>
        <h3>{item.title}</h3><p>{item.detail}</p>
      </div>
      <div className="decision-actions">
        <button className="secondary-button" type="button" onClick={() => onOpen(item)}>Quelle öffnen <ArrowRight size={15} aria-hidden="true" /></button>
        {reviewKind(item.kind) ? <button className="decision-subaction" type="button" disabled={Boolean(busy)} onClick={() => void acknowledge(item)}>{busy === item.id ? 'Speichert…' : item.kind === 'guest' ? 'Als gelesen markieren' : 'Als geprüft markieren'}</button> : null}
      </div>
    </article>)}</div> : null}
    {visiblePage?.hasMore ? <div className="decision-review-more"><p>Weitere passende Einträge sind vorhanden.</p><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Lade…' : 'Ältere Einträge laden'}</button></div> : null}
    {visiblePage?.limitReached ? <p className="inline-note" role="status">Mehr als 10.000 Einträge passen zur Suche. Schränke sie nach Projekt oder Grund ein.</p> : null}
  </section>;
}
