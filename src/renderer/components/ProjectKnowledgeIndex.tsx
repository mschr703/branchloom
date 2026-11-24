import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import type { ProjectMemoryHit, ProjectMemoryIndexStatus, ProjectMemorySourceDetail, ProjectMemorySourceKind } from '../../shared/project-memory-index';
import './project-knowledge-index.css';

const kindLabels: Record<ProjectMemorySourceKind, string> = {
  task: 'Aufgabe', conversation: 'Agentenverlauf', commit: 'Commit', code: 'Code',
};
const filters: Array<ProjectMemorySourceKind | 'all'> = ['all', 'task', 'conversation', 'commit', 'code'];
const messageOf = (value: unknown): string => value instanceof Error ? value.message : String(value);

interface Props {
  snapshot: ProjectSnapshot;
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}

export function ProjectKnowledgeIndex({ snapshot, onOpenCard, onOpenSession }: Props) {
  const projectId = snapshot.project.id;
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ProjectMemorySourceKind | 'all'>('all');
  const [status, setStatus] = useState<ProjectMemoryIndexStatus | null>(null);
  const [hits, setHits] = useState<ProjectMemoryHit[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ProjectMemorySourceDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const revision = useMemo(() => `${snapshot.cards.length}:${snapshot.cards.reduce((latest, card) => card.updatedAt > latest ? card.updatedAt : latest, '')}:${snapshot.sessions.filter((session) => session.state !== 'running').length}`, [snapshot.cards, snapshot.sessions]);
  const selected = hits.find((hit) => `${hit.kind}:${hit.sourceId}` === selectedId) ?? null;

  useEffect(() => { setQuery(''); setKind('all'); setSelectedId(''); setDetail(null); setStatus(null); setHits([]); setLoading(true); }, [projectId]);

  useEffect(() => {
    let active = true;
    setDetail(null); setDetailError('');
    if (selected?.kind !== 'code' && selected?.kind !== 'commit') return () => { active = false; };
    void window.studio.readProjectMemorySource({ projectId, kind: selected.kind, sourceId: selected.sourceId })
      .then((value) => { if (active) { setDetail(value); if (!value) setDetailError('Diese Quelle ist im aktuellen Index nicht mehr vorhanden.'); } })
      .catch((reason: unknown) => { if (active) setDetailError(messageOf(reason)); });
    return () => { active = false; };
  }, [projectId, selected?.kind, selected?.sourceId]);

  useEffect(() => {
    let active = true;
    setRefreshing(true); setError('');
    void window.studio.refreshProjectMemoryIndex(projectId)
      .then((value) => { if (active) setStatus(value); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [projectId, revision]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void window.studio.searchProjectMemoryIndex({ projectId, query, kind })
        .then((result) => { if (active) { setStatus(result.status); setHits(result.hits); setLoading(false); } })
        .catch((reason: unknown) => { if (active) { setError(messageOf(reason)); setLoading(false); } });
    }, query ? 140 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [projectId, query, kind, refreshing]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true); setError('');
    try { setStatus(await window.studio.refreshProjectMemoryIndex(projectId, true)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setRefreshing(false); }
  }

  function sourceAction(hit: ProjectMemoryHit) {
    if (hit.kind === 'conversation' && hit.sessionId && onOpenSession) onOpenSession(hit.sessionId);
    else if (hit.kind === 'task' && hit.cardId && onOpenCard) onOpenCard(hit.cardId);
  }

  return <section className="project-knowledge-index" aria-label="Automatischer Projektindex">
    <div className="knowledge-index-head"><div><h2>Projektwissen</h2><p>Durchsuche Aufgaben, Agentenverläufe, Commits und den getrackten Code dieses Projekts.</p></div><button className="text-button" type="button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" /> {refreshing ? 'Index wird aktualisiert…' : 'Index aktualisieren'}</button></div>
    {status ? <div className="knowledge-index-sources" aria-label="Indexierte Quellen"><span>{status.counts.task} Aufgaben</span><span>{status.counts.conversation} Agentenverläufe</span><span>{status.counts.commit} Commits</span><span>{status.counts.code} Codepassagen</span><small>{status.indexedAt ? `Stand ${new Date(status.indexedAt).toLocaleString('de-DE')}` : 'Noch nicht indexiert'}</small></div> : null}
    {status?.warning ? <p className="knowledge-index-warning" role="status">{status.warning}</p> : null}
    {status?.state === 'partial' ? <p className="knowledge-index-limit">{status.codeFilesIndexed} von {status.codeFilesSeen} geeigneten Codedateien erfasst. Nicht erfasste Inhalte liefern keine Treffer.</p> : null}
    <div className="knowledge-index-controls"><label><Search size={17} aria-hidden="true" /><input value={query} maxLength={160} onChange={(event) => { setQuery(event.target.value); setSelectedId(''); }} aria-label="Projektwissen durchsuchen" placeholder="Was wurde zu … gemacht?" /></label><div role="group" aria-label="Quelle filtern">{filters.map((item) => <button key={item} type="button" aria-pressed={kind === item} onClick={() => { setKind(item); setSelectedId(''); }}>{item === 'all' ? 'Alle' : kindLabels[item]}</button>)}</div></div>
    {error ? <p className="knowledge-index-warning error" role="alert">{error}</p> : null}
    <div className="knowledge-index-body"><div className="knowledge-index-results" aria-label="Quellentreffer">{loading ? <p>Quellen werden geladen…</p> : hits.length ? hits.map((hit) => <button key={`${hit.kind}:${hit.sourceId}`} type="button" className={selectedId === `${hit.kind}:${hit.sourceId}` ? 'knowledge-index-result selected' : 'knowledge-index-result'} aria-current={selectedId === `${hit.kind}:${hit.sourceId}` ? 'true' : undefined} onClick={() => setSelectedId(`${hit.kind}:${hit.sourceId}`)}><span>{kindLabels[hit.kind]} · {new Date(hit.updatedAt).toLocaleDateString('de-DE')}</span><strong>{hit.title}</strong><small>{hit.snippet || 'Kein Textauszug verfügbar.'}</small></button>) : <p>{query ? 'Keine passenden Quellen gefunden.' : 'Noch keine indexierten Quellen. Aufgaben und Agentenläufe erscheinen nach dem ersten gespeicherten Schritt.'}</p>}</div>
      <aside className="knowledge-index-detail" aria-label="Quellbeleg">{selected ? <><span>{kindLabels[selected.kind]}</span><h3>{selected.title}</h3>{selected.path ? <code>{selected.path}</code> : null}{selected.gitRef ? <small>Commitstand {selected.gitRef.slice(0, 12)} · Arbeitsdateien können inzwischen anders aussehen.</small> : null}{selected.kind === 'code' || selected.kind === 'commit' ? detail ? <pre>{detail.body}</pre> : <p>{detailError || 'Gespeicherter Quellausschnitt wird geladen…'}</p> : <p>{selected.snippet || 'Kein Textauszug verfügbar.'}</p>}{(selected.kind === 'task' && onOpenCard || selected.kind === 'conversation' && onOpenSession) ? <button className="secondary-button" type="button" onClick={() => sourceAction(selected)}>Quelle öffnen <ArrowUpRight size={15} aria-hidden="true" /></button> : null}</> : <><h3>Quellen statt Vermutungen</h3><p>Wähle einen Treffer. Jede Aussage hier verweist auf eine gespeicherte Aufgabe, einen Agentenlauf oder einen konkreten Git-Stand.</p></>}</aside></div>
    <p className="knowledge-index-foot">Die Suche läuft lokal und sucht Wörter. Semantische Ähnlichkeit, automatische Zusammenfassungen und eine Karte der Agentengespräche sind noch nicht aktiv.</p>
  </section>;
}
