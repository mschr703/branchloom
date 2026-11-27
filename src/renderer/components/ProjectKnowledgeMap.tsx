import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Search } from 'lucide-react';
import type { Card, CardContextReference, ProjectSnapshot, Session } from '../../shared/types';
import type { ProjectMemoryHit, ProjectMemoryMapSources, ProjectMemorySourceDetail } from '../../shared/project-memory-index';
import { knowledgeMapFileForHit, knowledgeMapPageForCard, projectKnowledgeMapPage, visibleKnowledgeCodeFiles } from '../project-knowledge-map';
import { defaultKnowledgeFocus, initialKnowledgeNetworkViewport, knowledgeNeighborhood, layoutKnowledgeNetwork } from '../knowledge-network-layout';
import '@xyflow/react/dist/style.css';
import './project-knowledge-map.css';

interface Props {
  snapshot: ProjectSnapshot;
  indexRevision?: string | null;
  reveal?: (ProjectMemoryHit & { token: number }) | null;
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}

function nodeLabel(kind: 'task' | 'conversation' | 'file' | 'folder' | 'commit' | 'code', title: string, detail: string) {
  const label = { task: 'Aufgabe', conversation: 'Agentenlauf', file: 'Kontextdatei', folder: 'Kontextordner', commit: 'Git-Stand', code: 'Indexierte Datei' }[kind];
  return <div className="knowledge-map-node-label"><span>{label}</span><strong title={title}>{title}</strong><small>{detail}</small></div>;
}

const referenceNodeId = (reference: CardContextReference) => `source:${reference.kind}:${reference.target}`;

export type KnowledgeMapLayer = 'all' | 'work' | 'code';
export type KnowledgeMapArrangement = 'network' | 'structure';

export type KnowledgeMapRelationship = { id: string; group: 'Agentenläufe' | 'Kartenkontext' | 'Git-Quellen'; reason: string };

/** Describe only edges that the map has built from a saved run, attachment, or indexed Git source. */
export function knowledgeMapRelationships(selectedId: string, edges: Pick<Edge, 'source' | 'target'>[]): KnowledgeMapRelationship[] {
  const related = new Map<string, KnowledgeMapRelationship>();
  for (const edge of edges) {
    if (edge.source !== selectedId && edge.target !== selectedId) continue;
    const id = edge.source === selectedId ? edge.target : edge.source;
    const taskRun = edge.source.startsWith('task:') && edge.target.startsWith('conversation:');
    const taskSource = edge.source.startsWith('task:') && edge.target.startsWith('source:');
    const commitSource = edge.source.startsWith('commit:') && edge.target.startsWith('source:file:');
    if (taskRun) related.set(id, { id, group: 'Agentenläufe', reason: selectedId === edge.source ? 'Gespeicherter Lauf dieser Aufgabe' : 'Dieser Aufgabe zugeordnet' });
    if (taskSource) related.set(id, { id, group: 'Kartenkontext', reason: selectedId === edge.source ? 'Explizit an die Karte geheftet' : 'Als Kontext an diese Karte geheftet' });
    if (commitSource) related.set(id, { id, group: 'Git-Quellen', reason: selectedId === edge.source ? 'Aus diesem Git-Stand indexiert' : 'Datei aus diesem Git-Stand indexiert' });
  }
  return [...related.values()].sort((a, b) => a.group.localeCompare(b.group, 'de') || a.id.localeCompare(b.id));
}

export function knowledgeMapFlow(groups: ReturnType<typeof projectKnowledgeMapPage>['groups'], agents: ProjectSnapshot['agents'], selectedId: string,
  sources: ProjectMemoryMapSources | null = null, layer: KnowledgeMapLayer = 'all', fileQuery = '', arrangement: KnowledgeMapArrangement = 'structure'): { nodes: Node[]; edges: Edge[]; shownCodeFiles: ProjectMemoryMapSources['codeFiles'] } {
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenSources = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const sourceAnchors = new Map<string, { taskCenters: number[]; rowY: number }>();
  for (const group of groups) for (const reference of group.references) {
    const id = referenceNodeId(reference);
    sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  }
  if (layer !== 'code') for (const [index, group] of groups.entries()) {
    const x = (index % 2) * 560;
    const y = Math.floor(index / 2) * 340;
    const taskId = `task:${group.card.id}`;
    nodes.push({ id: taskId, position: { x: x + 106, y }, data: { label: nodeLabel('task', group.card.title, `${group.sessions.length} ${group.sessions.length === 1 ? 'Lauf' : 'Läufe'} · ${group.references.length} ${group.references.length === 1 ? 'Quelle' : 'Quellen'}`) },
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
      const anchor = sourceAnchors.get(sourceId) ?? { taskCenters: [], rowY: y + 224 };
      anchor.taskCenters.push(x + 251);
      anchor.rowY = Math.max(anchor.rowY, y + 224);
      sourceAnchors.set(sourceId, anchor);
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
  const sourceRows = new Map<number, Node[]>();
  for (const node of nodes) {
    const anchor = sourceAnchors.get(node.id);
    if (!anchor) continue;
    node.position = { x: anchor.taskCenters.reduce((sum, center) => sum + center, 0) / anchor.taskCenters.length - 105, y: anchor.rowY };
    const row = sourceRows.get(anchor.rowY) ?? [];
    row.push(node);
    sourceRows.set(anchor.rowY, row);
  }
  for (const row of sourceRows.values()) {
    row.sort((a, b) => a.position.x - b.position.x || a.id.localeCompare(b.id));
    for (let index = 1; index < row.length; index++) row[index]!.position.x = Math.max(row[index]!.position.x, row[index - 1]!.position.x + 238);
  }
  const shownCodeFiles = layer === 'work' ? [] : visibleKnowledgeCodeFiles(sources, groups.flatMap((group) => group.references), fileQuery, layer === 'code' ? 12 : 8);
  const gitY = layer === 'code' ? 20 : Math.ceil(groups.length / 2) * 340 + 48;
  const commitId = sources?.headCommit ? `commit:${sources.headCommit.sourceId}` : null;
  if (commitId && layer !== 'work') nodes.push({ id: commitId, position: { x: 300, y: gitY },
    data: { label: nodeLabel('commit', sources!.headCommit!.title, sources!.headCommit!.sourceId.slice(0, 12)) },
    type: 'default', draggable: false, className: `knowledge-map-node commit${selectedId === commitId ? ' selected' : ''}` });
  for (const [index, file] of shownCodeFiles.entries()) {
    const id = `source:file:${file.path}`;
    const existing = nodes.find((node) => node.id === id);
    if (existing) existing.className = `${existing.className ?? ''} indexed`;
    else nodes.push({ id, position: { x: (index % 3) * 300 + 20, y: gitY + 118 + Math.floor(index / 3) * 94 },
      data: { label: nodeLabel('code', file.path, `Git ${sources!.gitRef!.slice(0, 12)}`) },
      type: 'default', draggable: false, className: `knowledge-map-node source indexed${selectedId === id ? ' selected' : ''}` });
    if (commitId) edges.push({ id: `${commitId}-${id}`, source: commitId, target: id, type: 'smoothstep',
      className: 'knowledge-map-link indexed' });
  }
  if (selectedId && nodes.some((node) => node.id === selectedId)) {
    const adjacent = new Set([selectedId]);
    for (const edge of edges) {
      if (edge.source === selectedId) adjacent.add(edge.target);
      if (edge.target === selectedId) adjacent.add(edge.source);
      edge.className = `${edge.className ?? ''} ${edge.source === selectedId || edge.target === selectedId ? 'emphasized' : 'quiet'}`;
    }
    for (const node of nodes) node.className = `${node.className ?? ''} ${adjacent.has(node.id) ? 'in-focus' : 'quiet'}`;
  }
  if (arrangement === 'network') {
    const positions = layoutKnowledgeNetwork(nodes.map((node) => ({ id: node.id, width: node.id.startsWith('task:') ? 174 : 146, height: 42 })), edges);
    for (const node of nodes) {
      node.position = positions.get(node.id) ?? node.position;
      node.className = `${node.className ?? ''} network`;
    }
    for (const edge of edges) edge.type = 'default';
  }
  return { nodes, edges, shownCodeFiles };
}

export function ProjectKnowledgeMap({ snapshot, indexRevision, reveal, onOpenCard, onOpenSession }: Props) {
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [layer, setLayer] = useState<KnowledgeMapLayer>('work');
  const [arrangement, setArrangement] = useState<KnowledgeMapArrangement>('network');
  const [networkScope, setNetworkScope] = useState<'focus' | 'all'>('focus');
  const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
  const [fileQuery, setFileQuery] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [listOpen, setListOpen] = useState(true);
  const [revealMessage, setRevealMessage] = useState('');
  const [indexed, setIndexed] = useState<ProjectMemoryMapSources | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexError, setIndexError] = useState('');
  const [sourceDetail, setSourceDetail] = useState<ProjectMemorySourceDetail | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [selectionHistory, setSelectionHistory] = useState<string[]>([]);
  const [referenceState, setReferenceState] = useState<{ key: string; references: CardContextReference[]; failed: number } | null>(null);
  const sourceListRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setPage(0); setSelectedId(''); setSelectionHistory([]); setLayer('work'); setFileQuery(''); setListQuery(''); setRevealMessage(''); setIndexed(null); setIndexLoading(true); setIndexError(''); setReferenceState(null); }, [snapshot.project.id]);
  useEffect(() => {
    if (!reveal) return;
    setArrangement('network');
    setNetworkScope('focus');
    setSelectionHistory([]);
    setRevealMessage('');
    if (reveal.kind === 'task' || reveal.kind === 'conversation') {
      const cardId = reveal.cardId ?? (reveal.kind === 'task' ? reveal.sourceId : null);
      if (!cardId) { setRevealMessage('Für diesen Treffer ist kein Aufgabenbezug gespeichert.'); return; }
      const targetPage = knowledgeMapPageForCard(snapshot, cardId);
      if (targetPage === null) { setRevealMessage('Die Aufgabe ist im aktuellen Projekt nicht mehr vorhanden. Index bitte aktualisieren.'); return; }
      const targetGroup = projectKnowledgeMapPage(snapshot, targetPage).groups.find((group) => group.card.id === cardId)!;
      const runVisible = reveal.kind === 'conversation' && targetGroup.sessions.some((session) => session.id === reveal.sessionId);
      setPage(targetPage);
      setLayer('work');
      setFileQuery('');
      setSelectedId(runVisible ? `conversation:${reveal.sessionId}` : `task:${cardId}`);
      if (reveal.kind === 'conversation' && !runVisible) setRevealMessage('Dieser ältere Agentenlauf liegt außerhalb des begrenzten Graph-Ausschnitts. Die zugehörige Aufgabe ist markiert; den vollständigen Lauf kannst du im Quellentreffer öffnen.');
      return;
    }
    setLayer('code');
    if (reveal.kind === 'commit') { setFileQuery(''); setSelectedId(`commit:${reveal.sourceId}`); return; }
    setFileQuery('');
    setSelectedId('');
    if (!reveal.path) setRevealMessage('Für diesen Codetreffer ist kein Dateipfad gespeichert.');
  }, [reveal?.token, snapshot.project.id]);
  useEffect(() => {
    if (reveal?.kind !== 'code' || !indexed || !reveal.path) return;
    const file = knowledgeMapFileForHit(indexed, reveal.path, reveal.sourceId);
    if (!file) { setRevealMessage('Diese Datei ist im aktuellen, auf 180 Dateien begrenzten Graph-Inventar nicht enthalten. Der Suchtreffer bleibt unter „Quellen durchsuchen“ lesbar.'); return; }
    setFileQuery(file.path);
    setSelectedId(`source:file:${file.path}`);
  }, [reveal?.token, indexed]);
  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
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
  useEffect(() => {
    let active = true;
    setIndexed(null); setIndexLoading(true); setIndexError('');
    void window.studio.projectMemoryMapSources(snapshot.project.id)
      .then((value) => { if (active) setIndexed(value); })
      .catch((reason: unknown) => { if (active) setIndexError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setIndexLoading(false); });
    return () => { active = false; };
  }, [snapshot.project.id, indexRevision]);
  const { nodes: allNodes, edges: allEdges, shownCodeFiles } = useMemo(() => knowledgeMapFlow(map.groups, snapshot.agents, selectedId, indexed, layer, fileQuery, arrangement),
    [map.groups, snapshot.agents, selectedId, indexed, layer, fileQuery, arrangement]);
  const focusRoot = allNodes.some((node) => node.id === selectedId) ? selectedId
    : defaultKnowledgeFocus(allNodes, allEdges, layer === 'code' ? 'commit:' : 'task:');
  const neighborhood = useMemo(() => knowledgeNeighborhood(allNodes.map((node) => ({ id: node.id,
    width: node.id.startsWith('task:') ? 220 : 190, height: 52 })), allEdges, focusRoot, focusDepth),
  [allNodes, allEdges, focusRoot, focusDepth]);
  const focusedNetwork = arrangement === 'network' && networkScope === 'focus' && allEdges.length > 0;
  const inspectedId = selectedId || (focusedNetwork ? focusRoot : '');
  const nodes = focusedNetwork ? allNodes.filter((node) => neighborhood.ids.has(node.id)).map((node) => ({ ...node,
    position: neighborhood.positions.get(node.id) ?? node.position,
    sourcePosition: Position.Right, targetPosition: Position.Left,
    className: `${node.className ?? ''} neighborhood${node.id === focusRoot ? ' focal' : ''}` })) : allNodes;
  const edges = focusedNetwork ? allEdges.filter((edge) => neighborhood.ids.has(edge.source) && neighborhood.ids.has(edge.target)).map((edge) => {
    // These edges have no arrows; orient their rendering left-to-right while
    // the saved source/target pair remains unchanged in allEdges and the inspector.
    const sourceX = neighborhood.positions.get(edge.source)?.x ?? 0;
    const targetX = neighborhood.positions.get(edge.target)?.x ?? 0;
    return sourceX <= targetX ? { ...edge, type: 'straight' } : { ...edge, source: edge.target, target: edge.source, type: 'straight' };
  }) : allEdges;
  const layoutKey = `${snapshot.project.id}:${map.page}:${layer}:${arrangement}:${networkScope}:${focusDepth}:${focusRoot}:${fileQuery}:${viewportWidth <= 860 ? 'narrow' : 'wide'}:${nodes.map((node) => node.id).join('|')}`;
  const narrowNetwork = arrangement === 'network' && viewportWidth <= 860;
  const initialViewport = narrowNetwork
    ? initialKnowledgeNetworkViewport(nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y,
      width: focusedNetwork ? node.id.startsWith('task:') ? 220 : 190 : node.id.startsWith('task:') ? 174 : 146,
      height: focusedNetwork ? 52 : 42 })), edges, Math.max(280, viewportWidth - 32), focusedNetwork ? focusRoot : undefined)
    : focusedNetwork && (focusDepth === 2 || nodes.length > 5)
      ? { x: 64, y: 170 - (neighborhood.positions.get(focusRoot)?.y ?? 38), zoom: 1 }
      : { x: 18, y: 12, zoom: 1 };
  const selectedCard = inspectedId.startsWith('task:') ? map.groups.find((group) => group.card.id === inspectedId.slice(5))?.card : null;
  const selectedRun = inspectedId.startsWith('conversation:') ? map.groups.flatMap((group) => group.sessions.map((session) => ({ session, card: group.card })))
    .find((item) => item.session.id === inspectedId.slice('conversation:'.length)) : null;
  const selectedSources = inspectedId.startsWith('source:') ? map.groups.flatMap((group) => group.references.map((reference) => ({ reference, card: group.card })))
    .filter((item) => referenceNodeId(item.reference) === inspectedId) : [];
  const selectedCode = inspectedId.startsWith('source:file:') ? indexed?.codeFiles.find((file) => `source:file:${file.path}` === inspectedId) ?? null : null;
  const selectedCommit = inspectedId.startsWith('commit:') && indexed?.headCommit?.sourceId === inspectedId.slice(7) ? indexed.headCommit : null;
  const selected: { kind: 'task'; card: Card } | { kind: 'conversation'; card: Card; session: Session }
    | { kind: 'source'; links: typeof selectedSources; code: typeof selectedCode }
    | { kind: 'commit'; commit: NonNullable<typeof selectedCommit> } | null = selectedCard
    ? { kind: 'task', card: selectedCard } : selectedRun ? { kind: 'conversation', ...selectedRun }
      : selectedSources.length || selectedCode ? { kind: 'source', links: selectedSources, code: selectedCode }
        : selectedCommit ? { kind: 'commit', commit: selectedCommit } : null;

  useEffect(() => {
    let active = true;
    setSourceDetail(null); setSourceError('');
    const input = selectedCode ? { projectId: snapshot.project.id, kind: 'code' as const, sourceId: selectedCode.sourceId }
      : selectedCommit ? { projectId: snapshot.project.id, kind: 'commit' as const, sourceId: selectedCommit.sourceId } : null;
    if (input) void window.studio.readProjectMemorySource(input)
      .then((value) => { if (active) { setSourceDetail(value); if (!value) setSourceError('Die indexierte Quelle ist nicht mehr vorhanden. Index bitte aktualisieren.'); } })
      .catch((reason: unknown) => { if (active) setSourceError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [snapshot.project.id, selectedCode?.sourceId, selectedCommit?.sourceId]);

  function changePage(next: number) { setPage(next); setSelectedId(''); setSelectionHistory([]); }
  function inspectSource(id: string) {
    if (id === inspectedId) return;
    if (inspectedId) setSelectionHistory((history) => [...history, inspectedId].slice(-20));
    setSelectedId(id);
  }
  function returnToSource() {
    let index = selectionHistory.length - 1;
    while (index >= 0 && !allNodes.some((node) => node.id === selectionHistory[index])) index -= 1;
    if (index < 0) { setSelectionHistory([]); return; }
    setSelectedId(selectionHistory[index]!);
    setSelectionHistory((history) => history.slice(0, index));
  }

  const listItems = allNodes.map((node) => {
    if (node.id.startsWith('task:')) return { id: node.id, group: 'Aufgaben', title: map.groups.find((group) => group.card.id === node.id.slice(5))?.card.title ?? node.id };
    if (node.id.startsWith('conversation:')) {
      const related = map.groups.flatMap((group) => group.sessions.map((session) => ({ session, card: group.card })))
        .find((item) => item.session.id === node.id.slice('conversation:'.length));
      const agent = snapshot.agents.find((item) => item.id === related?.session.agentId)?.name ?? 'Agent';
      return { id: node.id, group: 'Agentenläufe', title: `${agent}${related ? ` · ${related.card.title}` : ''}` };
    }
    if (node.id.startsWith('commit:')) return { id: node.id, group: 'Git-Quellen', title: `Git-Stand · ${indexed?.headCommit?.title ?? node.id}` };
    if (node.id.startsWith('source:file:')) return { id: node.id, group: 'Dateien & Ordner', title: node.id.slice('source:file:'.length) };
    return { id: node.id, group: 'Dateien & Ordner', title: node.id.slice('source:folder:'.length) };
  });
  const visibleListItems = listItems.filter((item) => item.title.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase()));
  const listGroups = ['Aufgaben', 'Agentenläufe', 'Git-Quellen', 'Dateien & Ordner'] as const;
  const relatedItems = selected ? knowledgeMapRelationships(inspectedId, allEdges)
    .map((relationship) => ({ ...relationship, item: listItems.find((item) => item.id === relationship.id) }))
    .filter((entry): entry is typeof entry & { item: (typeof listItems)[number] } => Boolean(entry.item)) : [];

  function onListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || buttons.length < 2) return;
    event.preventDefault();
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }

  return <div className="knowledge-map-view">
    <div className="knowledge-map-summary"><details><summary>Was zeigen die Linien?</summary><p>Wähle eine Quelle, um ihre direkten Verbindungen zu sehen. Linien belegen Kartenbezüge oder Dateien im indexierten Git-Stand, keine Themenähnlichkeit.</p></details><span>{map.totalCards} {map.totalCards === 1 ? 'Aufgabe' : 'Aufgaben'} · {map.totalSessions} {map.totalSessions === 1 ? 'Lauf' : 'Läufe'}{indexed?.gitRef ? ` · ${indexed.totalCodeFiles} ${indexed.totalCodeFiles === 1 ? 'indexierte Datei' : 'indexierte Dateien'}` : ''}</span></div>
    <div className="knowledge-map-toolbar"><div className="knowledge-map-layers" role="group" aria-label="Beziehungen filtern">
      <button type="button" aria-pressed={layer === 'all'} onClick={() => { setLayer('all'); setSelectedId(''); setSelectionHistory([]); }}>Alle</button>
      <button type="button" aria-pressed={layer === 'work'} onClick={() => { setLayer('work'); setSelectedId(''); setSelectionHistory([]); }}>Arbeit</button>
      <button type="button" aria-pressed={layer === 'code'} onClick={() => { setLayer('code'); setSelectedId(''); setSelectionHistory([]); }}>Git-Quellen</button>
    </div><div className="knowledge-map-toolbar-end">{layer !== 'work' ? <label className="knowledge-map-file-search"><Search size={15} aria-hidden="true" /><input aria-label="Indexierte Dateien filtern" value={fileQuery} onChange={(event) => { setFileQuery(event.target.value); setSelectedId(''); setSelectionHistory([]); }} placeholder="Dateipfad suchen" /></label> : null}<div className="knowledge-map-arrangements" role="group" aria-label="Kartenanordnung"><button type="button" aria-pressed={arrangement === 'network'} onClick={() => setArrangement('network')}>Netz</button><button type="button" aria-pressed={arrangement === 'structure'} onClick={() => setArrangement('structure')}>Struktur</button></div></div></div>
    {arrangement === 'network' && allEdges.length > 0 ? <div className="knowledge-map-scope"><div role="group" aria-label="Netzumfang"><button type="button" aria-pressed={networkScope === 'focus'} onClick={() => setNetworkScope('focus')}>Umgebung</button><button type="button" aria-pressed={networkScope === 'all'} onClick={() => setNetworkScope('all')}>Gesamtbild</button></div>{networkScope === 'focus' ? <label>Verbindungen <select aria-label="Verbindungstiefe" value={focusDepth} onChange={(event) => setFocusDepth(Number(event.target.value) as 1 | 2)}><option value={1}>1 Schritt</option><option value={2}>2 Schritte</option></select></label> : null}<span>{nodes.length}/{allNodes.length} Quellen im Ausschnitt</span></div> : null}
    {referenceState?.key !== referenceKey ? <p className="knowledge-map-source-status" role="status">Dateibezüge werden gelesen…</p> : referenceState.failed ? <p className="knowledge-map-source-status" role="status">{referenceState.failed} Kartenbezüge konnten nicht gelesen werden; die Karte ist unvollständig.</p> : null}
    {indexLoading ? <p className="knowledge-map-source-status" role="status">Git-Quellen werden gelesen…</p> : null}
    {indexError ? <p className="knowledge-map-source-status error" role="alert">Git-Quellen konnten nicht gelesen werden: {indexError}</p> : null}
    {revealMessage ? <p className="knowledge-map-source-status" role="status">{revealMessage}</p> : null}
    {reveal?.kind === 'commit' && !indexLoading && !allNodes.some((node) => node.id === `commit:${reveal.sourceId}`) ? <p className="knowledge-map-source-status" role="status">Dieser Git-Stand ist im aktuellen Graph-Ausschnitt nicht mehr vorhanden. Index bitte aktualisieren.</p> : null}
    {nodes.length ? <div className={`knowledge-map-layout ${arrangement}${focusedNetwork ? ' focus-view' : ''}`}>
      <div className="knowledge-map-canvas" role="region" aria-label="Beziehungskarte aus Aufgaben, Agentenläufen und Git-Quellen">
        <ReactFlow key={layoutKey} nodes={nodes} edges={edges} defaultViewport={initialViewport} fitView={arrangement === 'structure' || (focusedNetwork && focusDepth === 1 && nodes.length <= 5 && viewportWidth > 860)} fitViewOptions={{ padding: .14, maxZoom: 1.1 }}
          nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
          onNodeClick={(_, node) => inspectSource(node.id)} onNodeDoubleClick={(_, node) => {
            if (node.id.startsWith('task:')) onOpenCard?.(node.id.slice(5));
            else if (node.id.startsWith('conversation:')) onOpenSession?.(node.id.slice('conversation:'.length));
            else if (node.id.startsWith('source:')) {
              const linkedCard = map.groups.find((group) => group.references.some((reference) => referenceNodeId(reference) === node.id))?.card;
              if (linkedCard) onOpenCard?.(linkedCard.id);
            }
          }}>
          {!focusedNetwork ? <Background color="var(--border)" gap={28} size={1} /> : null}
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="knowledge-map-inspector" aria-label="Beziehungsdetails">
        {selectionHistory.length ? <button className="knowledge-map-back" type="button" onClick={returnToSource}><ArrowLeft size={14} aria-hidden="true" /> Zurück zur Quelle</button> : null}
        {selected ? selected.kind === 'source' ? <><span>{selected.code ? 'Indexierte Datei' : selected.links[0]?.reference.kind === 'file' ? 'Kontextdatei' : 'Kontextordner'}</span><h3>{selected.code?.path ?? selected.links[0]?.reference.target}</h3>
          {selected.links.length ? <p>{selected.links[0]!.reference.available ? 'Als Kontext an eine Aufgabe geheftet.' : 'Gespeicherter Kartenbezug; die Arbeitsdatei ist derzeit nicht verfügbar.'} Verknüpft am {new Date(selected.links[0]!.reference.addedAt).toLocaleString('de-DE')}.</p> : null}
          {selected.code ? <><p>Indexierter Git-Stand {indexed?.gitRef?.slice(0, 12)}. Arbeitsdateien können inzwischen anders aussehen.</p>{sourceDetail ? <pre className="knowledge-map-source-preview">{sourceDetail.body}</pre> : <p role={sourceError ? 'alert' : 'status'}>{sourceError || 'Quellausschnitt wird geladen…'}</p>}</> : null}
        </> : selected.kind === 'commit' ? <><span>Git-Stand</span><h3>{selected.commit.title}</h3><code>{selected.commit.sourceId.slice(0, 12)}</code><p>Commit vom {new Date(selected.commit.updatedAt).toLocaleString('de-DE')}. Verbundene Dateien wurden aus genau diesem Git-Stand indexiert.</p>{sourceDetail ? <pre className="knowledge-map-source-preview">{sourceDetail.body}</pre> : <p role={sourceError ? 'alert' : 'status'}>{sourceError || 'Committext wird geladen…'}</p>}</> : <><span>{selected.kind === 'task' ? 'Aufgabe' : 'Agentenlauf'}</span><h3>{selected.kind === 'task' ? selected.card.title : snapshot.agents.find((agent) => agent.id === selected.session.agentId)?.name ?? 'Agentenlauf'}</h3>
          <p>{selected.kind === 'task' ? selected.card.description || 'Keine Beschreibung gespeichert.' : `Gehört zu „${selected.card.title}“. Beendet am ${new Date(selected.session.endedAt ?? selected.session.startedAt).toLocaleString('de-DE')}. Zustand: ${selected.session.state}.`}</p>
          {(selected.kind === 'task' ? onOpenCard : onOpenSession) ? <button className="secondary-button" type="button" onClick={() => selected.kind === 'task' ? onOpenCard?.(selected.card.id) : onOpenSession?.(selected.session.id)}>Quelle öffnen <ArrowUpRight size={15} aria-hidden="true" /></button> : null}
        </> : <><span>Beziehungen</span><h3>Quelle auswählen</h3><p>Wähle einen Knoten oder nutze die Quellenliste. Doppelklick öffnet Aufgaben und Agentenläufe.</p></>}
        {selected ? <div className="knowledge-map-related">
          <div className="knowledge-map-related-heading"><strong>Belegte Verbindungen</strong><span>{relatedItems.length}</span></div>
          {relatedItems.length ? <ul>{relatedItems.map(({ id, item, group, reason }) => <li key={id}>
            <button type="button" onClick={() => inspectSource(id)}>
              <span className="knowledge-map-related-copy"><small>{group} · {reason}</small><span>{item.title}</span></span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
            {id.startsWith('task:') && onOpenCard ? <button className="knowledge-map-open-related" type="button" aria-label={`${item.title} öffnen`} onClick={() => onOpenCard(id.slice(5))}><ArrowUpRight size={14} aria-hidden="true" /></button>
              : id.startsWith('conversation:') && onOpenSession ? <button className="knowledge-map-open-related" type="button" aria-label={`${item.title} öffnen`} onClick={() => onOpenSession(id.slice('conversation:'.length))}><ArrowUpRight size={14} aria-hidden="true" /></button> : null}
          </li>)}</ul> : <p>Für diese Quelle ist in diesem Ausschnitt keine Beziehung gespeichert.</p>}
          <button type="button" className="knowledge-map-clear" onClick={() => { setSelectedId(''); setSelectionHistory([]); if (focusedNetwork) setNetworkScope('all'); }}>{focusedNetwork ? 'Gesamtbild zeigen' : 'Auswahl aufheben'}</button>
        </div> : null}
        <details className="knowledge-map-list" ref={sourceListRef} open={listOpen} onToggle={(event) => setListOpen(event.currentTarget.open)}><summary>Quellen als Liste ({listItems.length})</summary><label className="knowledge-map-list-search"><Search size={14} aria-hidden="true" /><input aria-label="Graphquellen filtern" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Quelle finden…" /></label><ul onKeyDown={onListKeyDown}>{listGroups.map((group) => { const items = visibleListItems.filter((item) => item.group === group); return items.length ? <li className="knowledge-map-list-group" key={group}><h4>{group} <small>{items.length}</small></h4><ul>{items.map((item) => <li key={item.id}><button type="button" aria-current={inspectedId === item.id ? 'true' : undefined} onClick={() => inspectSource(item.id)}>{item.title}</button></li>)}</ul></li> : null; })}{visibleListItems.length === 0 ? <li className="knowledge-map-list-none">Keine Quelle in diesem Ausschnitt gefunden.</li> : null}</ul></details>
      </aside>
    </div> : !indexLoading ? <p className="knowledge-map-empty">{layer === 'code' ? fileQuery ? 'Keine indexierte Datei passt zu diesem Pfad.' : 'Für dieses Projekt ist noch kein Git-Quellstand indexiert.' : 'Noch keine gespeicherten Aufgaben oder Git-Quellen.'}</p> : null}
    <div className="knowledge-map-pagination"><span>Aufgaben {map.page + 1}/{map.pages}{map.hiddenSessions ? ` · ${map.hiddenSessions} ältere Läufe ausgeblendet` : ''}{map.hiddenReferences ? ` · ${map.hiddenReferences} weitere Dateibezüge ausgeblendet` : ''}{layer !== 'work' && indexed ? ` · ${shownCodeFiles.length}/${indexed.totalCodeFiles} Dateien im Ausschnitt` : ''}</span><div><button className="icon-button" type="button" aria-label="Neuere Aufgaben zeigen" disabled={map.page === 0} onClick={() => changePage(map.page - 1)}><ArrowLeft size={16} /></button><button className="icon-button" type="button" aria-label="Weitere Aufgaben zeigen" disabled={map.page >= map.pages - 1} onClick={() => changePage(map.page + 1)}><ArrowRight size={16} /></button></div></div>
  </div>;
}
