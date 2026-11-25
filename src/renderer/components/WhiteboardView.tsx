import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, type Connection, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import { FolderTree, Link2, Plus, Trash2 } from 'lucide-react';
import type { ProjectSnapshot, WhiteboardNode, WhiteboardReference, WhiteboardSnapshot } from '../../shared/types';
import type { RepoMapProposal, RepoMapImportResult } from '../../shared/repo-map';
import type { WhiteboardDirectImporter, WhiteboardImpact } from '../../shared/whiteboard-impact';
import type { Mutate } from './shared';
import { RepoMapPreview } from './RepoMapPreview';
import { repoMapOverview } from '../repo-map-overview';
import { WhiteboardImpactResult } from './WhiteboardImpactResult';
import '@xyflow/react/dist/style.css';
import './whiteboard.css';

type EditDraft = { title: string; description: string; referenceKind: 'none' | 'card' | 'folder' | 'file'; cardId: string; folderPath: string };
type CardDraft = { title: string; description: string; columnId: string };
type ImpactCardDraft = CardDraft & { site: WhiteboardDirectImporter; nodeId: string; referencePath: string };
const emptyDraft = (): EditDraft => ({ title: '', description: '', referenceKind: 'none', cardId: '', folderPath: '' });
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const referenceSummary = (node: WhiteboardNode | undefined, snapshot: ProjectSnapshot): string => {
  if (!node) return 'Box fehlt';
  if (node.reference?.kind === 'card') {
    const cardId = node.reference.cardId;
    return `Karte: ${snapshot.cards.find((card) => card.id === cardId)?.title ?? cardId}`;
  }
  if (node.reference?.kind === 'folder') return `Ordner: ${node.reference.path}`;
  if (node.reference?.kind === 'file') return `Datei: ${node.reference.path}`;
  return 'Keine Verknüpfung';
};
const draftOf = (node: WhiteboardNode): EditDraft => ({ title: node.title, description: node.description,
  referenceKind: node.reference?.kind ?? 'none', cardId: node.reference?.kind === 'card' ? node.reference.cardId : '', folderPath: node.reference?.kind === 'folder' || node.reference?.kind === 'file' ? node.reference.path : '' });

function referenceOf(draft: EditDraft): WhiteboardReference | null {
  if (draft.referenceKind === 'card') return { kind: 'card', cardId: draft.cardId };
  if (draft.referenceKind === 'folder' || draft.referenceKind === 'file') return { kind: draft.referenceKind, path: draft.folderPath };
  return null;
}

export function WhiteboardView({ snapshot, mutate, onOpenCard, openNodeId }: { snapshot: ProjectSnapshot; mutate: Mutate; onOpenCard: (id: string) => void; openNodeId?: string | null }) {
  const projectId = snapshot.project.id;
  const [board, setBoard] = useState<WhiteboardSnapshot>({ nodes: [], edges: [] });
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapProposal, setMapProposal] = useState<RepoMapProposal | null>(null);
  const [mapError, setMapError] = useState('');
  const [mapBusy, setMapBusy] = useState(false);
  const [mapResult, setMapResult] = useState<RepoMapImportResult | null>(null);
  const [automaticProposal, setAutomaticProposal] = useState<RepoMapProposal | null>(null);
  const [automaticProposalProjectId, setAutomaticProposalProjectId] = useState<string | null>(null);
  const [automaticMapError, setAutomaticMapError] = useState('');
  const [automaticMapBusy, setAutomaticMapBusy] = useState(false);
  const [canvasMode, setCanvasMode] = useState<'board' | 'repository'>('board');
  const [repoRevision, setRepoRevision] = useState(0);
  const [selectedProposal, setSelectedProposal] = useState<string | null>(null);
  const [impact, setImpact] = useState<WhiteboardImpact | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactError, setImpactError] = useState('');
  const [impactCardDraft, setImpactCardDraft] = useState<ImpactCardDraft | null>(null);
  const impactRequest = useRef(0);
  const impactTitleRef = useRef<HTMLInputElement | null>(null);
  const impactReturnFocus = useRef<HTMLButtonElement | null>(null);
  const flowApi = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const latestProjectId = useRef(projectId);
  latestProjectId.current = projectId;

  const reload = useCallback(async () => {
    const next = await window.studio.whiteboard(projectId);
    setBoard(next);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setSelected(null);
    setSelectedEdge(null);
    setCardDraft(null);
    setBoard({ nodes: [], edges: [] });
    setMapProposal(null); setMapError(''); setMapResult(null); setMapBusy(false);
    setCanvasMode('board');
    setRepoRevision(0);
    setAutomaticProposal(null); setAutomaticProposalProjectId(null); setAutomaticMapError(''); setAutomaticMapBusy(false); setSelectedProposal(null);
    impactRequest.current++; setImpact(null); setImpactError(''); setImpactBusy(false); setImpactCardDraft(null);
    window.studio.whiteboard(projectId).then((next) => { if (live) setBoard(next); })
      .catch((reason: unknown) => { if (live) setError(message(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);

  useEffect(() => {
    if (!openNodeId) return;
    let live = true;
    void window.studio.whiteboard(projectId).then((next) => {
      if (!live) return;
      setBoard(next);
      if (next.nodes.some((item) => item.id === openNodeId)) {
        setCanvasMode('board');
        setSelected(openNodeId);
        setSelectedEdge(null);
        setCardDraft(null);
      }
    }).catch((reason: unknown) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [projectId, openNodeId]);

  useEffect(() => {
    if (loading || (board.nodes.length > 0 && canvasMode !== 'repository') || automaticProposal || automaticMapBusy || automaticMapError) return;
    let live = true;
    setAutomaticMapBusy(true);
    void window.studio.previewRepoMap(projectId)
      .then((proposal) => { if (live) { setAutomaticProposal(proposal); setAutomaticProposalProjectId(projectId); } })
      .catch((reason: unknown) => { if (live) setAutomaticMapError(message(reason)); })
      .finally(() => { if (live) setAutomaticMapBusy(false); });
    return () => { live = false; };
  }, [projectId, loading, board.nodes.length, canvasMode, repoRevision]);

  const showRepository = canvasMode === 'repository' || board.nodes.length === 0;
  const overview = useMemo(() => showRepository && automaticProposalProjectId === projectId && automaticProposal ? repoMapOverview(automaticProposal) : null,
    [showRepository, automaticProposalProjectId, projectId, automaticProposal]);
  const previewNode = overview?.nodes.find((node) => node.id === selectedProposal) ?? null;

  useEffect(() => {
    if (showRepository) {
      setFlowNodes(overview?.nodes.map((item) => ({ id: item.id, position: { x: item.x, y: item.y }, data: {
        label: <div className="wb-node-content"><strong>{item.title}</strong><small>{item.kind === 'package' ? 'Paketordner' : item.kind === 'folder' ? 'Ordner' : 'Mögliche UI-Komponente'} · {item.path}</small></div>,
      }, className: 'wb-node wb-proposal-node' })) ?? []);
      return;
    }
    setFlowNodes(board.nodes.map((item) => ({ id: item.id, position: { x: item.x, y: item.y }, data: {
      label: <div className="wb-node-content"><strong>{item.title}</strong>{item.description ? <span>{item.description}</span> : null}
        {item.reference?.kind === 'card' ? <small>Karte · {snapshot.cards.find((card) => card.id === (item.reference as { kind: 'card'; cardId: string }).cardId)?.title ?? 'entfernt'}</small> : null}
        {item.reference?.kind === 'folder' ? <small>Ordner · {item.reference.path}</small> : null}
        {item.reference?.kind === 'file' ? <small>Datei · {item.reference.path}</small> : null}</div>,
    }, className: `wb-node${item.reference ? ' wb-node-linked' : ''}` })));
  }, [board.nodes, overview, showRepository, snapshot.cards]);

  useEffect(() => {
    if (!flowNodes.length) return;
    const frame = requestAnimationFrame(() => { void flowApi.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [projectId, flowNodes.length]);

  const flowEdges = useMemo<Edge[]>(() => showRepository ? overview?.edges.map((item) => ({ id: `${item.sourceId}>${item.targetId}`, source: item.sourceId, target: item.targetId,
    type: 'smoothstep', className: 'wb-proposal-edge' })) ?? [] : board.edges.map((item) => ({ id: item.id, source: item.sourceId, target: item.targetId, label: item.label || undefined,
    type: 'smoothstep', className: 'wb-edge' })), [board.edges, overview, showRepository]);
  const selectedNode = board.nodes.find((item) => item.id === selected) ?? null;
  const edge = board.edges.find((item) => item.id === selectedEdge) ?? null;

  useEffect(() => { setDraft(selectedNode ? draftOf(selectedNode) : emptyDraft()); }, [selectedNode?.id]);
  useEffect(() => {
    impactRequest.current++;
    setImpact(null); setImpactError(''); setImpactBusy(false); setImpactCardDraft(null);
  }, [selectedNode?.id, selectedNode?.reference?.kind, selectedNode?.reference?.kind === 'file' || selectedNode?.reference?.kind === 'folder' ? selectedNode.reference.path : null]);
  useEffect(() => {
    impactRequest.current++;
    setImpact(null); setImpactError(''); setImpactBusy(false); setImpactCardDraft(null);
  }, [draft.referenceKind, draft.folderPath]);

  useEffect(() => { if (impactCardDraft) impactTitleRef.current?.focus(); }, [impactCardDraft?.site.path, impactCardDraft?.site.line]);

  async function inspectImpact() {
    if (!selectedNode || (selectedNode.reference?.kind !== 'file' && selectedNode.reference?.kind !== 'folder')) return;
    const request = ++impactRequest.current;
    setImpactBusy(true); setImpactError(''); setImpact(null); setImpactCardDraft(null);
    try {
      const result = await window.studio.whiteboardImpact({ projectId, nodeId: selectedNode.id });
      if (request === impactRequest.current && latestProjectId.current === projectId) setImpact(result);
    } catch (reason) { if (request === impactRequest.current && latestProjectId.current === projectId) setImpactError(message(reason)); }
    finally { if (request === impactRequest.current && latestProjectId.current === projectId) setImpactBusy(false); }
  }

  function suggestImpactCard(site: WhiteboardDirectImporter, button: HTMLButtonElement) {
    if (!impact || !selectedNode || selectedNode.id !== impact.nodeId) return;
    const safeColumns = snapshot.columns.filter((column) => !column.autoStart);
    const todo = safeColumns.find((column) => column.name.trim().toLocaleLowerCase('de-DE') === 'to do');
    impactReturnFocus.current = button;
    setImpactCardDraft({ site, nodeId: impact.nodeId, referencePath: impact.referencePath,
      title: `Änderung an ${site.targetPath} prüfen`.slice(0, 200), description: '', columnId: (todo ?? safeColumns[0])?.id ?? '' });
  }

  async function createImpactCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!impactCardDraft || busy || snapshot.queue.state === 'running') return;
    setBusy(true); setImpactError('');
    try {
      const created = await mutate(() => window.studio.createCardFromWhiteboardImpact({ projectId, ...impactCardDraft }));
      if (!created || latestProjectId.current !== projectId) return;
      setImpactCardDraft(null);
      onOpenCard(created.id);
    } catch (reason) {
      if (latestProjectId.current === projectId) {
        const detail = message(reason);
        setImpactError(detail);
        if (detail.includes('veraltet')) { setImpact(null); setImpactCardDraft(null); }
      }
    } finally { if (latestProjectId.current === projectId) setBusy(false); }
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true); setError('');
    try { await action(); await reload(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  function addNode() {
    void run(async () => {
      const index = board.nodes.length;
      const created = await window.studio.createWhiteboardNode({ projectId, title: 'Neue Box', x: (index % 3) * 260, y: Math.floor(index / 3) * 180 });
      setCanvasMode('board');
      setAutomaticProposal(null); setAutomaticProposalProjectId(null); setSelectedProposal(null);
      setSelected(created.id);
      setSelectedEdge(null);
      setCardDraft(null);
    });
  }

  function connect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    void run(() => window.studio.createWhiteboardEdge({ projectId, sourceId: connection.source!, targetId: connection.target! }));
  }

  function saveNode() {
    if (!selectedNode) return;
    void run(() => window.studio.updateWhiteboardNode({ projectId, id: selectedNode.id, title: draft.title, description: draft.description, reference: referenceOf(draft) }));
  }

  function deleteNode() {
    if (!selectedNode || !window.confirm(`Box „${selectedNode.title}“ und ihre Verbindungen entfernen?`)) return;
    void run(async () => { await window.studio.deleteWhiteboardNode({ projectId, id: selectedNode.id }); setSelected(null); });
  }

  function suggestCard() {
    if (!edge) return;
    const source = board.nodes.find((item) => item.id === edge.sourceId);
    const target = board.nodes.find((item) => item.id === edge.targetId);
    if (!source || !target) { setError('Die Boxen dieser Verbindung sind nicht mehr vorhanden. Whiteboard neu laden.'); return; }
    const todo = snapshot.columns.find((item) => item.name.trim().toLocaleLowerCase('de-DE') === 'to do');
    setCardDraft({ title: `${source.title} → ${target.title}`.slice(0, 200), description: '', columnId: (todo ?? snapshot.columns[0])?.id ?? '' });
  }

  async function createCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edge || !cardDraft || busy) return;
    setBusy(true); setError('');
    try {
      const created = await mutate(() => window.studio.createCardFromWhiteboardEdge({ projectId, edgeId: edge.id, ...cardDraft }));
      if (!created || latestProjectId.current !== projectId) return;
      await reload();
      setCardDraft(null);
      onOpenCard(created.id);
    } catch (reason) { if (latestProjectId.current === projectId) setError(message(reason)); }
    finally { if (latestProjectId.current === projectId) setBusy(false); }
  }

  async function acceptMap(nodeIds: string[]) {
    if (!mapProposal || mapBusy) return;
    setMapBusy(true); setMapError('');
    try {
      const result = await window.studio.acceptRepoMap({ projectId, fingerprint: mapProposal.fingerprint, nodeIds });
      if (latestProjectId.current !== projectId) return;
      await reload();
      setMapResult(result); setMapProposal(null); setAutomaticProposal(null); setAutomaticProposalProjectId(null); setSelectedProposal(null); setCanvasMode('board');
    } catch (reason) { if (latestProjectId.current === projectId) setMapError(message(reason)); }
    finally { if (latestProjectId.current === projectId) setMapBusy(false); }
  }

  return <div className="wb-view">
    <div className="view-header wb-heading"><div><h2>Architektur-Whiteboard</h2><p>Projektstruktur aus dem Git-Index ansehen, Quellen prüfen und eigene Verbindungen ergänzen.</p></div>
      <div className="wb-heading-actions">{board.nodes.length > 0 ? <button className="secondary-button" type="button" disabled={loading} onClick={() => { setCanvasMode(canvasMode === 'repository' ? 'board' : 'repository'); setSelected(null); setSelectedEdge(null); setSelectedProposal(null); }}><FolderTree size={16} /> {canvasMode === 'repository' ? 'Arbeitsfläche ansehen' : 'Git-Struktur ansehen'}</button> : null}<button className="primary-button" type="button" disabled={busy || loading} onClick={addNode}><Plus size={16} /> Box hinzufügen</button></div></div>
    {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" aria-label="Fehler schließen" onClick={() => setError('')}>×</button></div> : null}
    {mapResult ? <p className="wb-import-result" role="status">Repo-Struktur übernommen: {mapResult.createdNodes} neue Boxen, {mapResult.reusedNodes} vorhandene Boxen, {mapResult.createdEdges} neue Verbindungen.</p> : null}
    <div className="wb-workspace">
      <div className="wb-canvas" aria-label="Architektur-Canvas">
        {loading ? <div className="wb-loading">Whiteboard wird geladen…</div> : <ReactFlow nodes={flowNodes} edges={flowEdges} onNodesChange={onNodesChange} onConnect={connect}
          onInit={(instance) => { flowApi.current = instance; }}
          onNodeDragStop={(_event, node) => { if (!showRepository) void run(() => window.studio.updateWhiteboardNode({ projectId, id: node.id, x: node.position.x, y: node.position.y })); }}
          onNodeClick={(_event, node) => { if (overview) setSelectedProposal(node.id); else setSelected(node.id); setSelectedEdge(null); setCardDraft(null); }}
          onEdgeClick={(_event, clicked) => { if (overview) return; setSelectedEdge(clicked.id); setSelected(null); setCardDraft(null); }}
          onPaneClick={() => { setSelected(null); setSelectedEdge(null); setSelectedProposal(null); setCardDraft(null); }}
          nodesConnectable={!busy && !showRepository} nodesDraggable={!busy && !showRepository} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          deleteKeyCode={null} selectionKeyCode="Shift" attributionPosition="bottom-left">
          <Background color="var(--border)" gap={24} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable maskColor="var(--surface-2)" />
        </ReactFlow>}
        {!loading && overview && overview.nodes.length > 0 ? <div className="wb-source-banner" role="status"><strong>Vorschau aus Git</strong><span>{overview.nodes.length} von {automaticProposal?.nodes.length} Pfaden · nicht gespeichert</span></div> : null}
        {!loading && showRepository && !overview?.nodes.length ? <div className="wb-empty"><strong>{automaticMapBusy ? 'Git-Struktur wird gelesen…' : automaticMapError ? 'Git-Struktur nicht verfügbar.' : 'Keine geeigneten Git-Pfade.'}</strong><span>{automaticMapError ? 'Die Arbeitsfläche bleibt erhalten. Du kannst zu ihr zurückkehren oder eigene Boxen anlegen.' : 'Nur versionierte Projektpfade erscheinen in dieser Vorschau. Es wird nichts gespeichert.'}</span></div> : null}
      </div>
      <aside className="wb-inspector" aria-label="Whiteboard-Details">
        {showRepository ? <section className="wb-source-inspector"><h3>Git-Struktur</h3><p>Die Vorschau liest nur versionierte Pfade. Linien bedeuten „liegt im Ordner“; Importbeziehungen sind damit nicht belegt. Deine Arbeitsfläche wird dabei nicht verändert.</p>
          {automaticProposal?.truncated ? <p className="wb-source-warning">Der Scan ist begrenzt. Die vollständige Auswahl zeigt alle erfassten Pfade.</p> : null}
          {automaticMapError ? <p className="wb-source-warning" role="status">{automaticMapError}</p> : null}
          {overview?.nodes.length ? <><div className="wb-source-list" aria-label="Git-Pfade auswählen">{overview.nodes.map((item) => <button key={item.id} type="button" className={selectedProposal === item.id ? 'is-selected' : ''} onClick={() => { setSelectedProposal(item.id); void flowApi.current?.fitView({ nodes: [{ id: item.id }], padding: 0.5, maxZoom: 1.25, duration: 160 }); }}><strong>{item.title}</strong><small>{item.path}</small></button>)}</div>
            {previewNode ? <dl className="wb-source-detail"><div><dt>Pfad</dt><dd>{previewNode.path}</dd></div><div><dt>Quelle im Git-Index</dt><dd>{previewNode.evidence.path}</dd></div><div><dt>Einordnung</dt><dd>{previewNode.kind === 'component-candidate' ? 'Mögliche UI-Komponente (Dateiname)' : previewNode.kind === 'package' ? 'Paketordner (Manifestpfad)' : 'Ordner (versionierter Pfad)'}</dd></div></dl> : null}
            {overview.omittedNodes > 0 ? <p>{overview.omittedNodes} weitere Pfade stehen in der vollständigen Auswahl.</p> : null}
            <button className="primary-button" type="button" disabled={mapBusy} onClick={() => setMapProposal(automaticProposal)}>Struktur prüfen und übernehmen</button></> : null}
          <button className="secondary-button" type="button" disabled={automaticMapBusy} onClick={() => { setAutomaticProposal(null); setAutomaticProposalProjectId(null); setAutomaticMapError(''); setSelectedProposal(null); setRepoRevision((value) => value + 1); }}>Git-Stand neu lesen</button>
          <p>Erst nach deiner Auswahl wird ein Vorschlag lokal gespeichert.</p></section>
        : selectedNode ? <><h3>Box bearbeiten</h3><label>Titel<input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Beschreibung<textarea maxLength={2000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>Verknüpfung<select value={draft.referenceKind} onChange={(event) => setDraft({ ...draft, referenceKind: event.target.value as EditDraft['referenceKind'] })}><option value="none">Keine</option><option value="card">Karte</option><option value="folder">Projektordner</option><option value="file">Projektdatei</option></select></label>
          {draft.referenceKind === 'card' ? <label>Karte<select value={draft.cardId} onChange={(event) => setDraft({ ...draft, cardId: event.target.value })}><option value="">Karte auswählen</option>{snapshot.cards.map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label> : null}
          {draft.referenceKind === 'folder' || draft.referenceKind === 'file' ? <label>Relativer {draft.referenceKind === 'file' ? 'Datei' : 'Ordner'}pfad<input value={draft.folderPath} onChange={(event) => setDraft({ ...draft, folderPath: event.target.value })} placeholder={draft.referenceKind === 'file' ? 'src/renderer/App.tsx' : 'src/renderer'} /></label> : null}
          <div className="wb-actions"><button className="primary-button" type="button" disabled={busy || !draft.title.trim()} onClick={saveNode}>Speichern</button>
            {selectedNode.reference?.kind === 'card' && snapshot.cards.some((card) => card.id === (selectedNode.reference as { kind: 'card'; cardId: string }).cardId) ? <button className="secondary-button" type="button" onClick={() => onOpenCard((selectedNode.reference as { kind: 'card'; cardId: string }).cardId)}>Karte öffnen</button> : null}
            <button className="secondary-button wb-danger" type="button" disabled={busy} onClick={deleteNode}><Trash2 size={14} /> Entfernen</button></div>
          {selectedNode.reference?.kind === 'file' || selectedNode.reference?.kind === 'folder' ? <section className="wb-impact" aria-label="Änderungswirkung">
            <h4>Änderungswirkung</h4><p>Direkte relative Imports zur gespeicherten {selectedNode.reference.kind === 'file' ? 'Datei' : 'Ordnerstruktur'} suchen. Keine Agentenaktion.</p>
            <button className="secondary-button" type="button" disabled={impactBusy || busy || draft.referenceKind !== selectedNode.reference.kind || draft.folderPath !== selectedNode.reference.path} onClick={() => void inspectImpact()}>{impactBusy ? 'Prüfe Imports…' : 'Direkte Imports prüfen'}</button>
            {draft.referenceKind !== selectedNode.reference.kind || draft.folderPath !== selectedNode.reference.path ? <p className="wb-impact-note">Verknüpfung zuerst speichern.</p> : null}
            {impactError ? <p className="wb-impact-error" role="alert">{impactError}</p> : null}
            {impact ? <WhiteboardImpactResult impact={impact} onDraft={suggestImpactCard} /> : null}
            {impactCardDraft && impact?.nodeId === impactCardDraft.nodeId ? <form className="wb-card-form wb-impact-card-form" aria-label="Karte aus Importbeleg" onSubmit={(event) => void createImpactCard(event)}>
              <h4>Kartenentwurf</h4><p>Beleg: <code>{impactCardDraft.site.path}:{impactCardDraft.site.line}</code> → <code>{impactCardDraft.site.targetPath}</code></p>
              <p className="wb-impact-note">Der Beleg wird vor der Anlage erneut geprüft. Erst der Klick auf „Karte anlegen“ speichert die Aufgabe; ein Agent startet dadurch nicht.</p>
              <label>Kartentitel<input ref={impactTitleRef} required maxLength={200} value={impactCardDraft.title} onChange={(event) => setImpactCardDraft({ ...impactCardDraft, title: event.target.value })} /></label>
              <label>Auftrag<textarea rows={5} maxLength={28000} value={impactCardDraft.description} onChange={(event) => setImpactCardDraft({ ...impactCardDraft, description: event.target.value })} placeholder="Was soll geprüft oder geändert werden?" /></label>
              <label>Spalte<select value={impactCardDraft.columnId} onChange={(event) => setImpactCardDraft({ ...impactCardDraft, columnId: event.target.value })}>{snapshot.columns.filter((column) => !column.autoStart).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
              {snapshot.queue.state === 'running' ? <p className="wb-impact-note" role="status">Warteschlange vor dem Anlegen pausieren.</p> : null}
              {!snapshot.columns.some((column) => !column.autoStart) ? <p className="wb-impact-note" role="status">Eine Spalte ohne automatischen Agentenstart anlegen oder einstellen.</p> : null}
              <div className="wb-actions"><button className="primary-button" type="submit" disabled={busy || snapshot.queue.state === 'running' || !impactCardDraft.title.trim() || !impactCardDraft.columnId}>Karte anlegen</button>
                <button className="secondary-button" type="button" onClick={() => { setImpactCardDraft(null); impactReturnFocus.current?.focus(); }}>Abbrechen</button></div>
            </form> : null}
          </section> : null}</>
        : edge ? <><h3>Verbindung</h3><p>{board.nodes.find((item) => item.id === edge.sourceId)?.title} → {board.nodes.find((item) => item.id === edge.targetId)?.title}</p>
          <dl className="wb-edge-refs"><div><dt>Von</dt><dd>{referenceSummary(board.nodes.find((item) => item.id === edge.sourceId), snapshot)}</dd></div><div><dt>Nach</dt><dd>{referenceSummary(board.nodes.find((item) => item.id === edge.targetId), snapshot)}</dd></div></dl>
          {edge.cardId ? <><p className="wb-edge-note">Diese Verbindung hat bereits eine Karte. Änderungen an der Karte bleiben im Board.</p><button className="secondary-button" type="button" onClick={() => onOpenCard(edge.cardId!)}>Karte öffnen</button></>
            : cardDraft ? <form className="wb-card-form" onSubmit={(event) => void createCard(event)}>
              <p className="wb-edge-note">Die Verbindung und ihre Boxen werden beim Anlegen geprüft. Ihre Verknüpfungen werden als Whiteboard-Bezug auf der Karte gespeichert. Ein Agent startet dadurch nicht.</p>
              <label>Kartentitel<input required maxLength={200} value={cardDraft.title} onChange={(event) => setCardDraft({ ...cardDraft, title: event.target.value })} /></label>
              <label>Auftrag<textarea rows={5} maxLength={29000} value={cardDraft.description} onChange={(event) => setCardDraft({ ...cardDraft, description: event.target.value })} placeholder="Ziel und prüfbares Ergebnis beschreiben" /></label>
              <label>Spalte<select value={cardDraft.columnId} onChange={(event) => setCardDraft({ ...cardDraft, columnId: event.target.value })}>{snapshot.columns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {snapshot.queue.state === 'running' ? <p className="wb-edge-note" role="status">Pausiere die Warteschlange vor dem Anlegen der Karte.</p> : null}
              <div className="wb-actions"><button className="primary-button" type="submit" disabled={busy || snapshot.queue.state === 'running' || !cardDraft.title.trim() || !cardDraft.columnId}>Karte anlegen</button><button className="secondary-button" type="button" onClick={() => setCardDraft(null)}>Abbrechen</button></div>
            </form> : <button className="secondary-button" type="button" disabled={busy} onClick={suggestCard}><Plus size={14} /> Kartenentwurf aus Verbindung</button>}
          <button className="secondary-button wb-danger" type="button" disabled={busy} onClick={() => void run(async () => { await window.studio.deleteWhiteboardEdge({ projectId, id: edge.id }); setSelectedEdge(null); setCardDraft(null); })}><Trash2 size={14} /> Verbindung entfernen</button></>
        : board.nodes.length === 0 ? <section className="wb-source-inspector"><h3>Leere Arbeitsfläche</h3>
          <p>{automaticMapBusy ? 'Branchloom liest die versionierten Projektpfade. Es werden keine Dateien verändert.' : 'Du kannst eine eigene Box anlegen oder die Projektstruktur aus Git prüfen.'}</p>
          {automaticMapError ? <p className="wb-source-warning" role="status">Git-Vorschau nicht verfügbar: {automaticMapError}</p> : null}
        </section>
        : <><h3>Verbinden</h3><p>Ziehe eine Linie zwischen Boxen oder wähle beide hier aus.</p><label>Von<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Box auswählen</option>{board.nodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Nach<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Box auswählen</option>{board.nodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <button className="secondary-button" type="button" disabled={busy || !sourceId || !targetId || sourceId === targetId} onClick={() => void run(() => window.studio.createWhiteboardEdge({ projectId, sourceId, targetId }))}><Link2 size={14} /> Verbinden</button>
          {board.edges.length ? <div className="wb-edge-list"><h4>Verbindungen</h4>{board.edges.map((item) => <button className="secondary-button wb-edge-list-item" type="button" key={item.id} onClick={() => { setSelectedEdge(item.id); setCardDraft(null); }}><span>{board.nodes.find((node) => node.id === item.sourceId)?.title ?? 'Entfernte Box'} → {board.nodes.find((node) => node.id === item.targetId)?.title ?? 'Entfernte Box'}</span><small>{item.cardId ? 'Karte vorhanden' : 'Öffnen'}</small></button>)}</div> : null}</>}
      </aside>
    </div>
    {mapProposal ? <RepoMapPreview proposal={mapProposal} busy={mapBusy} error={mapError} onClose={() => { setMapProposal(null); setMapError(''); }} onAccept={(ids) => void acceptMap(ids)} /> : null}
  </div>;
}
