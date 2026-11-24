import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { Card, CardContextReference, ProjectSnapshot, Session } from '../../shared/types';
import { projectKnowledgeMapPage } from '../project-knowledge-map';
import '@xyflow/react/dist/style.css';
import './project-knowledge-map.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}

function nodeLabel(kind: 'task' | 'conversation' | 'file' | 'folder', title: string, detail: string) {
  const label = { task: 'Aufgabe', conversation: 'Agentenlauf', file: 'Projektdatei', folder: 'Projektordner' }[kind];
  return <div className="knowledge-map-node-label"><span>{label}</span><strong title={title}>{title}</strong><small>{detail}</small></div>;
}

const referenceNodeId = (reference: CardContextReference) => `source:${reference.kind}:${reference.target}`;

export function knowledgeMapFlow(groups: ReturnType<typeof projectKnowledgeMapPage>['groups'], agents: ProjectSnapshot['agents'], selectedId: string): { nodes: Node[]; edges: Edge[] } {
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenSources = new Set<string>();
  const sourceCounts = new Map<string, number>();
  for (const group of groups) for (const reference of group.references) {
    const id = referenceNodeId(reference);
    sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  }
  for (const [index, group] of groups.entries()) {
    const x = (index % 2) * 560;
    const y = Math.floor(index / 2) * 340;
    const taskId = `task:${group.card.id}`;
    nodes.push({ id: taskId, position: { x: x + 106, y }, data: { label: nodeLabel('task', group.card.title, `${group.sessions.length} Läufe · ${group.references.length} Quellen`) },
      type: 'default', draggable: false, className: `knowledge-map-node task${selectedId === taskId ? ' selected' : ''}` });
    for (const [runIndex, session] of group.sessions.entries()) {
      const runId = `conversation:${session.id}`;
      const agentName = names.get(session.agentId) ?? 'Agent';
      nodes.push({ id: runId, position: { x: x + runIndex * 238, y: y + 112 }, data: { label: nodeLabel('conversation', agentName, new Date(session.endedAt ?? session.startedAt).toLocaleDateString('de-DE')) },
        type: 'default', draggable: false, className: `knowledge-map-node conversation${selectedId === runId ? ' selected' : ''}` });
      edges.push({ id: `${taskId}-${runId}`, source: taskId, target: runId, type: 'smoothstep', className: 'knowledge-map-link' });
    }
    for (const [referenceIndex, reference] of group.references.entries()) {
      const sourceId = referenceNodeId(reference);
      if (!seenSources.has(sourceId)) {
        seenSources.add(sourceId);
        nodes.push({ id: sourceId, position: { x: x + referenceIndex * 238, y: y + 224 },
          data: { label: nodeLabel(reference.kind as 'file' | 'folder', reference.target,
            reference.available ? `${sourceCounts.get(sourceId)} ${sourceCounts.get(sourceId) === 1 ? 'Aufgabe' : 'Aufgaben'} verknüpft` : 'Quelle derzeit nicht verfügbar') },
          type: 'default', draggable: false, className: `knowledge-map-node source${!reference.available ? ' unavailable' : ''}${selectedId === sourceId ? ' selected' : ''}` });
      }
      edges.push({ id: `${taskId}-${sourceId}`, source: taskId, target: sourceId, type: 'smoothstep', className: `knowledge-map-link source${!reference.available ? ' unavailable' : ''}` });
    }
  }
  return { nodes, edges };
}

export function ProjectKnowledgeMap({ snapshot, onOpenCard, onOpenSession }: Props) {
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [referenceState, setReferenceState] = useState<{ key: string; references: CardContextReference[]; failed: number } | null>(null);
  const sourceListRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setPage(0); setSelectedId(''); setReferenceState(null); }, [snapshot.project.id]);
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 860px)')?.matches && sourceListRef.current) sourceListRef.current.open = true;
  }, []);
  const baseMap = useMemo(() => projectKnowledgeMapPage(snapshot, page), [snapshot, page]);
  const referenceKey = `${snapshot.project.id}:${baseMap.page}:${baseMap.groups.map((group) => group.card.id).join(',')}`;
  useEffect(() => {
    let active = true;
    setReferenceState(null);
    void Promise.all(baseMap.groups.map(async ({ card }) => {
      try { return { references: await window.studio.cardContextReferences(card.id), failed: false }; }
      catch { return { references: [] as CardContextReference[], failed: true }; }
    })).then((results) => {
      if (active) setReferenceState({ key: referenceKey, references: results.flatMap((result) => result.references), failed: results.filter((result) => result.failed).length });
    });
    return () => { active = false; };
  }, [referenceKey]);
  const references = referenceState?.key === referenceKey ? referenceState.references : [];
  const map = useMemo(() => projectKnowledgeMapPage(snapshot, page, references), [snapshot, page, references]);
  const { nodes, edges } = useMemo(() => knowledgeMapFlow(map.groups, snapshot.agents, selectedId), [map.groups, snapshot.agents, selectedId]);
  const selectedCard = selectedId.startsWith('task:') ? map.groups.find((group) => group.card.id === selectedId.slice(5))?.card : null;
  const selectedRun = selectedId.startsWith('conversation:') ? map.groups.flatMap((group) => group.sessions.map((session) => ({ session, card: group.card })))
    .find((item) => item.session.id === selectedId.slice('conversation:'.length)) : null;
  const selectedSources = selectedId.startsWith('source:') ? map.groups.flatMap((group) => group.references.map((reference) => ({ reference, card: group.card })))
    .filter((item) => referenceNodeId(item.reference) === selectedId) : [];
  const selected: { kind: 'task'; card: Card } | { kind: 'conversation'; card: Card; session: Session } | { kind: 'source'; links: typeof selectedSources } | null = selectedCard
    ? { kind: 'task', card: selectedCard } : selectedRun ? { kind: 'conversation', ...selectedRun } : selectedSources.length ? { kind: 'source', links: selectedSources } : null;

  function changePage(next: number) { setPage(next); setSelectedId(''); }

  return <div className="knowledge-map-view">
    <div className="knowledge-map-summary"><p>Linien zeigen gespeicherte Kartenbezüge: abgeschlossene Agentenläufe sowie bewusst angeheftete Projektdateien und Ordner. Eine gemeinsame Datei verbindet dadurch mehrere Aufgaben. Positionen zeigen keine semantische Nähe.</p><span>{map.totalCards} Aufgaben · {map.totalSessions} belegte Läufe{referenceState?.key === referenceKey ? ` · ${map.totalReferences} Dateibezüge` : ''}</span></div>
    {referenceState?.key !== referenceKey ? <p className="knowledge-map-source-status" role="status">Dateibezüge werden gelesen…</p> : referenceState.failed ? <p className="knowledge-map-source-status" role="status">{referenceState.failed} Kartenbezüge konnten nicht gelesen werden; die Karte ist unvollständig.</p> : null}
    {map.groups.length ? <div className="knowledge-map-layout">
      <div className="knowledge-map-canvas" role="region" aria-label="Beziehungskarte aus Aufgaben und Agentenläufen">
        <ReactFlow key={`${snapshot.project.id}:${map.page}`} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: .14, maxZoom: 1.2 }}
          nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
          onNodeClick={(_, node) => setSelectedId(node.id)} onNodeDoubleClick={(_, node) => {
            if (node.id.startsWith('task:')) onOpenCard?.(node.id.slice(5));
            else if (node.id.startsWith('conversation:')) onOpenSession?.(node.id.slice('conversation:'.length));
            else if (node.id.startsWith('source:')) {
              const linkedCard = map.groups.find((group) => group.references.some((reference) => referenceNodeId(reference) === node.id))?.card;
              if (linkedCard) onOpenCard?.(linkedCard.id);
            }
          }}>
          <Background color="var(--border)" gap={28} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="knowledge-map-inspector" aria-label="Beziehungsdetails">
        {selected ? selected.kind === 'source' ? <><span>{selected.links[0]!.reference.kind === 'file' ? 'Projektdatei' : 'Projektordner'}</span><h3>{selected.links[0]!.reference.target}</h3>
          <p>{selected.links[0]!.reference.available ? 'Bewusst als Kontext an eine Karte geheftet.' : 'Gespeicherter Bezug; die Quelle ist derzeit nicht verfügbar.'} Zuletzt verknüpft am {new Date(selected.links[0]!.reference.addedAt).toLocaleString('de-DE')}.</p>
          <div className="knowledge-map-related"><strong>Verknüpfte Aufgaben</strong>{selected.links.map(({ card }) => <button key={card.id} type="button" onClick={() => onOpenCard?.(card.id)} disabled={!onOpenCard}>{card.title} <ArrowUpRight size={13} aria-hidden="true" /></button>)}</div>
        </> : <><span>{selected.kind === 'task' ? 'Aufgabe' : 'Agentenlauf'}</span><h3>{selected.kind === 'task' ? selected.card.title : snapshot.agents.find((agent) => agent.id === selected.session.agentId)?.name ?? 'Agentenlauf'}</h3>
          <p>{selected.kind === 'task' ? selected.card.description || 'Keine Beschreibung gespeichert.' : `Gehört zu „${selected.card.title}“. Beendet am ${new Date(selected.session.endedAt ?? selected.session.startedAt).toLocaleString('de-DE')}. Zustand: ${selected.session.state}.`}</p>
          {(selected.kind === 'task' ? onOpenCard : onOpenSession) ? <button className="secondary-button" type="button" onClick={() => selected.kind === 'task' ? onOpenCard?.(selected.card.id) : onOpenSession?.(selected.session.id)}>Quelle öffnen <ArrowUpRight size={15} aria-hidden="true" /></button> : null}
        </> : <><span>Beziehungen</span><h3>Arbeit nachvollziehen</h3><p>Wähle einen Punkt, um seine Quelle zu sehen. Doppelklick öffnet die Aufgabe oder den gespeicherten Lauf.</p></>}
        <details className="knowledge-map-list" ref={sourceListRef}><summary>Quellen als Liste</summary><ul>{map.groups.flatMap((group) => [<li key={`task:${group.card.id}`}><button type="button" onClick={() => setSelectedId(`task:${group.card.id}`)}>Aufgabe · {group.card.title}</button></li>, ...group.sessions.map((session) => <li key={`conversation:${session.id}`}><button type="button" onClick={() => setSelectedId(`conversation:${session.id}`)}>Agentenlauf · {snapshot.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Agent'} · {group.card.title}</button></li>), ...group.references.map((reference) => <li key={`${group.card.id}:${reference.id}`}><button type="button" onClick={() => setSelectedId(referenceNodeId(reference))}>{reference.kind === 'file' ? 'Datei' : 'Ordner'} · {reference.target} · {group.card.title}</button></li>)])}</ul></details>
      </aside>
    </div> : <p className="knowledge-map-empty">Noch keine gespeicherten Aufgaben. Sobald ein abgeschlossener Agentenlauf vorhanden ist, wird seine Zuordnung zur Aufgabe automatisch sichtbar.</p>}
    <div className="knowledge-map-pagination"><span>Ausschnitt {map.page + 1} von {map.pages}{map.hiddenSessions ? ` · ${map.hiddenSessions} ältere Läufe ausgeblendet` : ''}{map.hiddenReferences ? ` · ${map.hiddenReferences} weitere Dateibezüge ausgeblendet` : ''}</span><div><button className="icon-button" type="button" aria-label="Neuere Aufgaben zeigen" disabled={map.page === 0} onClick={() => changePage(map.page - 1)}><ArrowLeft size={16} /></button><button className="icon-button" type="button" aria-label="Weitere Aufgaben zeigen" disabled={map.page >= map.pages - 1} onClick={() => changePage(map.page + 1)}><ArrowRight size={16} /></button></div></div>
  </div>;
}
