import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { Card, ProjectSnapshot, Session } from '../../shared/types';
import { projectKnowledgeMapPage } from '../project-knowledge-map';
import '@xyflow/react/dist/style.css';
import './project-knowledge-map.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}

function nodeLabel(kind: 'task' | 'conversation', title: string, detail: string) {
  return <div className="knowledge-map-node-label"><span>{kind === 'task' ? 'Aufgabe' : 'Agentenlauf'}</span><strong>{title}</strong><small>{detail}</small></div>;
}

function flowData(groups: ReturnType<typeof projectKnowledgeMapPage>['groups'], agents: ProjectSnapshot['agents'], selectedId: string): { nodes: Node[]; edges: Edge[] } {
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const [index, group] of groups.entries()) {
    const x = (index % 2) * 520;
    const y = Math.floor(index / 2) * 240;
    const taskId = `task:${group.card.id}`;
    nodes.push({ id: taskId, position: { x: x + 106, y }, data: { label: nodeLabel('task', group.card.title, `${group.sessions.length} sichtbare Läufe`) },
      type: 'default', draggable: false, className: `knowledge-map-node task${selectedId === taskId ? ' selected' : ''}` });
    for (const [runIndex, session] of group.sessions.entries()) {
      const runId = `conversation:${session.id}`;
      const agentName = names.get(session.agentId) ?? 'Agent';
      nodes.push({ id: runId, position: { x: x + runIndex * 238, y: y + 112 }, data: { label: nodeLabel('conversation', agentName, new Date(session.endedAt ?? session.startedAt).toLocaleDateString('de-DE')) },
        type: 'default', draggable: false, className: `knowledge-map-node conversation${selectedId === runId ? ' selected' : ''}` });
      edges.push({ id: `${taskId}-${runId}`, source: taskId, target: runId, type: 'smoothstep', className: 'knowledge-map-link' });
    }
  }
  return { nodes, edges };
}

export function ProjectKnowledgeMap({ snapshot, onOpenCard, onOpenSession }: Props) {
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const sourceListRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setPage(0); setSelectedId(''); }, [snapshot.project.id]);
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 860px)')?.matches && sourceListRef.current) sourceListRef.current.open = true;
  }, []);
  const map = useMemo(() => projectKnowledgeMapPage(snapshot, page), [snapshot, page]);
  const { nodes, edges } = useMemo(() => flowData(map.groups, snapshot.agents, selectedId), [map.groups, snapshot.agents, selectedId]);
  const selectedCard = selectedId.startsWith('task:') ? map.groups.find((group) => group.card.id === selectedId.slice(5))?.card : null;
  const selectedRun = selectedId.startsWith('conversation:') ? map.groups.flatMap((group) => group.sessions.map((session) => ({ session, card: group.card })))
    .find((item) => item.session.id === selectedId.slice('conversation:'.length)) : null;
  const selected: { kind: 'task'; card: Card } | { kind: 'conversation'; card: Card; session: Session } | null = selectedCard
    ? { kind: 'task', card: selectedCard } : selectedRun ? { kind: 'conversation', ...selectedRun } : null;

  function changePage(next: number) { setPage(next); setSelectedId(''); }

  return <div className="knowledge-map-view">
    <div className="knowledge-map-summary"><p>Gespeicherte Aufgaben und abgeschlossene Agentenläufe. Jede Linie bedeutet: Dieser Lauf gehört zu dieser Aufgabe. Positionen zeigen keine semantische Ähnlichkeit; geplante Architektur bleibt im Whiteboard editierbar.</p><span>{map.totalCards} Aufgaben · {map.totalSessions} belegte Läufe</span></div>
    {map.groups.length ? <div className="knowledge-map-layout">
      <div className="knowledge-map-canvas" role="region" aria-label="Beziehungskarte aus Aufgaben und Agentenläufen">
        <ReactFlow key={`${snapshot.project.id}:${map.page}`} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: .14, maxZoom: 1.2 }}
          nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
          onNodeClick={(_, node) => setSelectedId(node.id)} onNodeDoubleClick={(_, node) => {
            if (node.id.startsWith('task:')) onOpenCard?.(node.id.slice(5));
            else if (node.id.startsWith('conversation:')) onOpenSession?.(node.id.slice('conversation:'.length));
          }}>
          <Background color="var(--border)" gap={28} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="knowledge-map-inspector" aria-label="Beziehungsdetails">
        {selected ? <><span>{selected.kind === 'task' ? 'Aufgabe' : 'Agentenlauf'}</span><h3>{selected.kind === 'task' ? selected.card.title : snapshot.agents.find((agent) => agent.id === selected.session.agentId)?.name ?? 'Agentenlauf'}</h3>
          <p>{selected.kind === 'task' ? selected.card.description || 'Keine Beschreibung gespeichert.' : `Gehört zu „${selected.card.title}“. Beendet am ${new Date(selected.session.endedAt ?? selected.session.startedAt).toLocaleString('de-DE')}. Zustand: ${selected.session.state}.`}</p>
          {(selected.kind === 'task' ? onOpenCard : onOpenSession) ? <button className="secondary-button" type="button" onClick={() => selected.kind === 'task' ? onOpenCard?.(selected.card.id) : onOpenSession?.(selected.session.id)}>Quelle öffnen <ArrowUpRight size={15} aria-hidden="true" /></button> : null}
        </> : <><span>Beziehungen</span><h3>Arbeit nachvollziehen</h3><p>Wähle einen Punkt, um seine Quelle zu sehen. Doppelklick öffnet die Aufgabe oder den gespeicherten Lauf.</p></>}
        <details className="knowledge-map-list" ref={sourceListRef}><summary>Quellen als Liste</summary><ul>{map.groups.flatMap((group) => [<li key={`task:${group.card.id}`}><button type="button" onClick={() => setSelectedId(`task:${group.card.id}`)}>Aufgabe · {group.card.title}</button></li>, ...group.sessions.map((session) => <li key={`conversation:${session.id}`}><button type="button" onClick={() => setSelectedId(`conversation:${session.id}`)}>Agentenlauf · {snapshot.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Agent'} · {group.card.title}</button></li>)])}</ul></details>
      </aside>
    </div> : <p className="knowledge-map-empty">Noch keine gespeicherten Aufgaben. Sobald ein abgeschlossener Agentenlauf vorhanden ist, wird seine Zuordnung zur Aufgabe automatisch sichtbar.</p>}
    <div className="knowledge-map-pagination"><span>Ausschnitt {map.page + 1} von {map.pages}{map.hiddenSessions ? ` · ${map.hiddenSessions} ältere Läufe dieser Aufgaben ausgeblendet` : ''}</span><div><button className="icon-button" type="button" aria-label="Neuere Aufgaben zeigen" disabled={map.page === 0} onClick={() => changePage(map.page - 1)}><ArrowLeft size={16} /></button><button className="icon-button" type="button" aria-label="Weitere Aufgaben zeigen" disabled={map.page >= map.pages - 1} onClick={() => changePage(map.page + 1)}><ArrowRight size={16} /></button></div></div>
  </div>;
}
