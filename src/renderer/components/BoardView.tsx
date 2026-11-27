import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowDown, ArrowUp, Copy, FileJson2, FolderOpen, GripVertical, MessageCircle, MoreHorizontal, Pencil, Plus, Search, Terminal, X } from 'lucide-react';
import type { Card, CardPriority, Column, ColumnEffort, ProjectSnapshot } from '../../shared/types';
import type { WorkflowRunEvidence } from '../../shared/workflow-evidence';
import { CARD_PRIORITIES } from '../../shared/card-metadata';
import { COLUMN_EFFORTS } from '../../shared/column-settings';
import type { Mutate } from './shared';
import { CardPanel } from './CardPanel';
import { TrelloImportPanel } from './TrelloImportPanel';
import { TaskDraftAssistant } from './TaskDraftAssistant';
import { QaCoveragePanel } from './QaCoveragePanel';
import { ColumnSettingsSheet } from './ColumnSettingsSheet';
import { BoardDependencyTrace } from './BoardDependencyTrace';
import { BoardSessionDock } from './BoardSessionDock';
import { BoardWorkflowMarkers } from './BoardWorkflowMarkers';
import { cardWorkflowSignal, type BoardWorkflowSignal } from '../board-workflow-signals';
import { filterBoardCards, type BoardVisibility } from '../board-filters';
import '../board-metadata.css';
import '../board-bulk.css';
import '../column-order.css';
import '../column-settings.css';
import '../board-refine.css';
import '../board-card-actions.css';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openCard?: { id: string; token: number; reviewCommentId?: string; qaReportId?: string } | null; onOpenDesign?: (cardId: string) => void; onOpenBrowser?: () => void; onOpenQaReport?: (cardId: string, reportId: string) => void }

export function isMoveShortcut(event: Pick<React.KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): boolean {
  return event.key.toLocaleLowerCase() === 'm' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function moveDestinations(columns: Column[], card: Card): Column[] {
  return card.archivedAt ? [] : columns.filter((column) => column.id !== card.columnId);
}

export function boardEmptyMessage(index: number, hasActiveCards: boolean, filtersActive: boolean): string | null {
  if (filtersActive) return 'Keine passenden Karten';
  if (hasActiveCards) return null;
  return index === 0 ? 'Erstelle unten deine erste Aufgabe. Verschiebe sie später zwischen den Spalten.' : null;
}

export function BoardView({ snapshot, mutate, openCard, onOpenDesign, onOpenBrowser, onOpenQaReport }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusSession, setFocusSession] = useState(false);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [newColumn, setNewColumn] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showTaskDraft, setShowTaskDraft] = useState(false);
  const [query, setQuery] = useState('');
  const [filterColumnId, setFilterColumnId] = useState('');
  const [visibility, setVisibility] = useState<BoardVisibility>('active');
  const [filterPriority, setFilterPriority] = useState<CardPriority | ''>('');
  const [filterLabel, setFilterLabel] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [bulkNotice, setBulkNotice] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<Set<string>>(() => new Set());
  const [bulkDestinationId, setBulkDestinationId] = useState('');
  const [bulkPriority, setBulkPriority] = useState<CardPriority | ''>('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const [confirmBulkPriority, setConfirmBulkPriority] = useState<{ cardIds: string[]; priority: CardPriority; changeCount: number } | null>(null);
  const [focusMoved, setFocusMoved] = useState<{ cardId: string; columnId: string } | null>(null);
  const [workflowEvidence, setWorkflowEvidence] = useState<Record<string, WorkflowRunEvidence>>({});
  const [workflowEvidenceError, setWorkflowEvidenceError] = useState(false);
  const [workflowEvidenceRetry, setWorkflowEvidenceRetry] = useState(0);
  const focusBeforeDrawer = useRef<HTMLElement | null>(null);
  const activeWorkflows = snapshot.workflows.filter((item) => item.state === 'running' || item.state === 'paused');
  const workflowEvidenceKey = JSON.stringify([activeWorkflows.map((item) => [item.id, item.state, item.updatedAt, item.currentStep]), snapshot.sessions.map((item) => [item.id, item.state])]);
  const columns = useMemo(() => [...snapshot.columns].sort((a, b) => a.position - b.position), [snapshot.columns]);
  const visibleCards = useMemo(() => filterBoardCards(snapshot.cards, { query, columnId: filterColumnId, visibility, priority: filterPriority, label: filterLabel }), [snapshot.cards, query, filterColumnId, visibility, filterPriority, filterLabel]);
  const labels = useMemo(() => {
    const unique = new Map<string, string>();
    for (const card of snapshot.cards) for (const label of card.labels) {
      const key = label.toLocaleLowerCase('de-DE');
      if (!unique.has(key)) unique.set(key, label);
    }
    return [...unique.values()].sort((a, b) => a.localeCompare(b, 'de-DE'));
  }, [snapshot.cards]);
  const visibleColumns = filterColumnId ? columns.filter((column) => column.id === filterColumnId) : columns;
  const archivedCount = snapshot.cards.filter((card) => card.archivedAt).length;
  const hasActiveCards = snapshot.cards.some((card) => !card.archivedAt);
  const filtersActive = Boolean(query.trim() || filterColumnId || filterPriority || filterLabel) || visibility !== 'active';
  const selected = snapshot.cards.find((card) => card.id === selectedId) ?? null;
  const requestedCardAvailable = Boolean(openCard && snapshot.cards.some((card) => card.id === openCard.id));
  const columnOrder = new Map(columns.map((column, index) => [column.id, index]));
  const selectableCards = visibleCards.filter((card) => !card.archivedAt).sort((a, b) => (columnOrder.get(a.columnId) ?? 0) - (columnOrder.get(b.columnId) ?? 0) || compareCardOrder(a, b));
  const selectedBulkCards = selectableCards.filter((card) => bulkIds.has(card.id));
  const bulkDestination = columns.find((column) => column.id === bulkDestinationId);
  const bulkMoveCount = selectedBulkCards.filter((card) => card.columnId !== bulkDestinationId).length;
  const bulkPriorityCount = bulkPriority ? selectedBulkCards.filter((card) => card.priority !== bulkPriority).length : 0;

  useEffect(() => { if (filterLabel && !labels.some((label) => label.toLocaleLowerCase('de-DE') === filterLabel.toLocaleLowerCase('de-DE'))) setFilterLabel(''); }, [labels, filterLabel]);
  useEffect(() => { setBulkIds(new Set()); setConfirmBulkArchive(false); setConfirmBulkPriority(null); setBulkNotice(''); }, [snapshot.project.id, query, filterColumnId, visibility, filterPriority, filterLabel]);
  useEffect(() => { setBulkIds((previous) => new Set([...previous].filter((id) => selectableCards.some((card) => card.id === id)))); setConfirmBulkPriority(null); }, [snapshot.cards]);
  useEffect(() => { if (!columns.some((column) => column.id === bulkDestinationId)) setBulkDestinationId(columns[0]?.id ?? ''); }, [columns, bulkDestinationId]);
  useEffect(() => {
    let cancelled = false;
    setWorkflowEvidence({});
    setWorkflowEvidenceError(false);
    if (!activeWorkflows.length || !window.studio?.workflowRunEvidence) return;
    void Promise.allSettled(activeWorkflows.map((workflow) => window.studio.workflowRunEvidence({ projectId: snapshot.project.id, workflowId: workflow.id })))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, WorkflowRunEvidence> = {};
        results.forEach((result, index) => { if (result.status === 'fulfilled') next[activeWorkflows[index]!.id] = result.value; });
        setWorkflowEvidence(next);
        setWorkflowEvidenceError(results.some((result) => result.status === 'rejected' || (result.status === 'fulfilled' && result.value.moreAvailable)));
      });
    return () => { cancelled = true; };
  }, [snapshot.project.id, workflowEvidenceKey, workflowEvidenceRetry]);
  // A cross-view navigation can arrive before the refreshed snapshot contains
  // a newly created card. Open it when that card becomes available as well.
  useEffect(() => { if (openCard && requestedCardAvailable) openBoardCard(openCard.id); }, [openCard?.id, openCard?.token, snapshot.project.id, requestedCardAvailable]);
  useEffect(() => {
    if (!focusMoved || snapshot.cards.find((card) => card.id === focusMoved.cardId)?.columnId !== focusMoved.columnId) return;
    const button = document.getElementById(`board-card-${focusMoved.cardId}`);
    if (button) { button.focus(); setFocusMoved(null); }
  }, [focusMoved, snapshot.cards, visibleCards, filterColumnId]);

  async function addCard(event: React.FormEvent<HTMLFormElement>, columnId: string) {
    event.preventDefault();
    const created = await mutate(() => window.studio.createCard({ projectId: snapshot.project.id, columnId, title: title.trim() }));
    if (created) { setCreatingIn(null); setTitle(''); openBoardCard(created.id); }
  }

  function openBoardCard(cardId: string, showSession = false, sessionId: string | null = null) {
    if (!selectedId) focusBeforeDrawer.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusSession(showSession);
    setFocusSessionId(sessionId);
    setSelectedId(cardId);
  }

  function closeBoardCard() {
    const cardId = selectedId;
    const previous = focusBeforeDrawer.current;
    focusBeforeDrawer.current = null;
    setSelectedId(null);
    requestAnimationFrame(() => {
      if (previous?.isConnected) previous.focus();
      else {
        const cardButton = cardId ? document.getElementById(`board-card-${cardId}`) : null;
        (cardButton ?? document.querySelector<HTMLElement>('.board-search input'))?.focus();
      }
    });
  }

  async function addColumn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await mutate(() => window.studio.createColumn({ projectId: snapshot.project.id, name: newColumn.trim() }));
    if (created) setNewColumn('');
  }

  async function moveCard(card: Card, columnId: string): Promise<boolean> {
    if (card.archivedAt || card.columnId === columnId) return false;
    const destination = columns.find((column) => column.id === columnId);
    if (!destination) return false;
    const moved = await mutate(() => window.studio.moveCard({ id: card.id, columnId }));
    if (!moved) { setAnnouncement(`„${card.title}“ konnte nicht verschoben werden.`); return false; }
    setAnnouncement(`„${card.title}“ wurde nach „${destination.name}“ verschoben.${destination.autoStart && destination.agentId ? ' Der Spaltenagent wurde automatisch gestartet.' : ''}`);
    if (filterColumnId && filterColumnId !== columnId) setFilterColumnId('');
    setFocusMoved({ cardId: card.id, columnId });
    return true;
  }

  async function reorderCard(card: Card, direction: 'up' | 'down'): Promise<void> {
    if (card.archivedAt) return;
    const changed = await mutate(() => window.studio.reorderCard({ id: card.id, direction }));
    setAnnouncement(changed
      ? `„${card.title}“ wurde in „${columns.find((item) => item.id === card.columnId)?.name ?? 'der Spalte'}“ ${direction === 'up' ? 'nach oben' : 'nach unten'} gesetzt.`
      : `Die Reihenfolge von „${card.title}“ konnte nicht geändert werden.`);
  }

  async function reorderColumn(column: Column, direction: 'left' | 'right'): Promise<void> {
    const changed = await mutate(() => window.studio.reorderColumn({ id: column.id, direction }));
    setAnnouncement(changed
      ? `Spalte „${column.name}“ wurde nach ${direction === 'left' ? 'links' : 'rechts'} verschoben.`
      : `Die Reihenfolge von „${column.name}“ konnte nicht geändert werden.`);
  }

  function onDrop(event: React.DragEvent<HTMLElement>, columnId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/card-id');
    const card = snapshot.cards.find((item) => item.id === id);
    if (card && !card.archivedAt && card.columnId !== columnId) void moveCard(card, columnId);
  }

  function toggleBulk(id: string) {
    setConfirmBulkArchive(false);
    setConfirmBulkPriority(null);
    setBulkNotice('');
    setBulkIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else if (next.size < 100) next.add(id);
      return next;
    });
  }

  async function applyBulk(action: 'move' | 'archive') {
    if (!selectedBulkCards.length || bulkBusy || snapshot.queue?.state === 'running') return;
    if (action === 'move' && (!bulkDestination || !bulkMoveCount)) return;
    const cardIds = selectedBulkCards.map((card) => card.id);
    setBulkBusy(true);
    try {
      const changed = await mutate(() => window.studio.bulkUpdateCards(action === 'move'
        ? { projectId: snapshot.project.id, cardIds, action, columnId: bulkDestinationId }
        : { projectId: snapshot.project.id, cardIds, action }));
      if (!changed) return;
      setBulkIds(new Set());
      setConfirmBulkArchive(false);
      setConfirmBulkPriority(null);
      setBulkNotice(action === 'move'
        ? `${bulkMoveCount} Karten wurden nach „${bulkDestination?.name}“ verschoben. Spaltenagenten wurden nicht gestartet.`
        : `${changed.length} Karten wurden archiviert.`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkPriority() {
    const confirmation = confirmBulkPriority;
    if (!confirmation || bulkBusy || snapshot.queue?.state === 'running') return;
    setBulkBusy(true);
    try {
      const changed = await mutate(() => window.studio.bulkUpdateCards({ projectId: snapshot.project.id, cardIds: confirmation.cardIds, action: 'priority', priority: confirmation.priority }));
      if (!changed) return;
      setBulkIds(new Set());
      setConfirmBulkPriority(null);
      const label = CARD_PRIORITIES.find((item) => item.value === confirmation.priority)?.label ?? confirmation.priority;
      setBulkNotice(`${changed.length} ${changed.length === 1 ? 'Karte hat' : 'Karten haben'} jetzt Priorität „${label}“. Es wurden keine Agenten gestartet.`);
    } finally { setBulkBusy(false); }
  }

  return <div className="board-page">
    <div className="board-toolbar board-header-actions">
      <div className="board-project-heading"><h2>Board</h2><span>{snapshot.sessions.filter((session) => session.state === 'running').length} {snapshot.sessions.filter((session) => session.state === 'running').length === 1 ? 'Agent aktiv' : 'Agenten aktiv'}</span></div>
      <div className="board-header-tools"><button className="secondary-button" type="button" onClick={() => setShowTaskDraft(true)} title="Mit einem Agenten aus einer Idee eine überprüfbare Aufgabe formulieren"><MessageCircle size={16} /> Aufgabe vorbereiten</button><button className="secondary-button" type="button" onClick={() => setShowImport(true)}><FileJson2 size={16} /> Trello importieren</button><QaCoveragePanel key={snapshot.project.id} snapshot={snapshot} onOpenQaReport={onOpenQaReport ?? ((cardId) => openBoardCard(cardId))} />{visibility !== 'archived' && columns[0] ? <button className="board-new-task primary-button" type="button" onClick={() => { setCreatingIn(columns[0]!.id); setTitle(''); }}><Plus size={16} aria-hidden="true" />Neue Aufgabe</button> : null}</div>
    </div>
    <div className="board-filters" role="search" aria-label="Board-Filter">
      <label className="board-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Karten suchen…" aria-label="Karten suchen" aria-describedby="board-filter-help" /></label>
      <label className="board-quick-filter"><span className="sr-only">Priorität filtern</span><select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value as CardPriority | '')} aria-label="Priorität filtern"><option value="">Alle Prioritäten</option>{CARD_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="board-quick-filter"><span className="sr-only">Label filtern</span><select value={filterLabel} onChange={(event) => setFilterLabel(event.target.value)} aria-label="Label filtern"><option value="">Alle Labels</option>{labels.map((label) => <option key={label} value={label}>{label}</option>)}</select></label>
      <details className="board-filter-options"><summary>Weitere Filter{filterColumnId || visibility !== 'active' ? ' · aktiv' : ''}</summary><div className="board-filter-fields"><label><span className="sr-only">Spalte filtern</span><select value={filterColumnId} onChange={(event) => setFilterColumnId(event.target.value)} aria-label="Spalte filtern"><option value="">Alle Spalten</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
      <label><span className="sr-only">Archivstatus filtern</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as BoardVisibility)} aria-label="Archivstatus filtern"><option value="active">Aktive Karten</option><option value="archived">Archiv ({archivedCount})</option><option value="all">Alle Karten</option></select></label>
      </div></details>
      <span className="board-filter-count" role="status" aria-live="polite">{visibleCards.length} Treffer</span>
      {selectableCards.length > 0 ? <button className="board-selection-toggle secondary-button" type="button" aria-pressed={bulkMode} onClick={() => { setBulkMode((current) => !current); setBulkIds(new Set()); setConfirmBulkArchive(false); setConfirmBulkPriority(null); setBulkNotice(''); }}>{bulkMode ? 'Auswahl beenden' : 'Karten auswählen'}</button> : null}
      {workflowEvidenceError ? <span className="board-workflow-error" role="status">Workflow-Verlauf nicht vollständig geladen. <button type="button" onClick={() => setWorkflowEvidenceRetry((value) => value + 1)}>Erneut laden</button></span> : null}
      <span id="board-filter-help" className="sr-only">Karten mit Tab erreichen. Enter öffnet Details, M öffnet die Verschiebeauswahl. Pfeiltasten-Schaltflächen ändern die Reihenfolge innerhalb der vollständigen Spalte, auch wenn Karten ausgefiltert sind. Archivierte Karten bleiben an ihrem Platz.</span>
    </div>
    {bulkMode && (selectableCards.length > 0 || selectedBulkCards.length > 0) ? <div className="board-bulk-actions" aria-label="Sammelaktionen">
      <label className="board-bulk-all"><input type="checkbox" checked={selectableCards.length > 0 && selectedBulkCards.length === selectableCards.length} disabled={selectableCards.length === 0 || selectableCards.length > 100 || bulkBusy} onChange={(event) => { setConfirmBulkArchive(false); setConfirmBulkPriority(null); setBulkNotice(''); setBulkIds(event.target.checked ? new Set(selectableCards.map((card) => card.id)) : new Set()); }} /> Sichtbare aktive Karten auswählen</label>
      <strong>{selectedBulkCards.length} ausgewählt</strong>
      {selectedBulkCards.length ? <><button className="secondary-button small" type="button" onClick={() => { setBulkIds(new Set()); setConfirmBulkArchive(false); setConfirmBulkPriority(null); setBulkNotice(''); }}>Auswahl aufheben</button>
        <label>Zielspalte <select aria-label="Zielspalte für ausgewählte Karten" value={bulkDestinationId} disabled={bulkBusy || snapshot.queue?.state === 'running'} onChange={(event) => setBulkDestinationId(event.target.value)}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
        <button className="secondary-button small" type="button" disabled={!bulkDestination || !bulkMoveCount || bulkBusy || snapshot.queue?.state === 'running'} onClick={() => void applyBulk('move')}>Ausgewählte verschieben</button>
        <button className="secondary-button small" type="button" disabled={bulkBusy || snapshot.queue?.state === 'running'} onClick={() => { setConfirmBulkPriority(null); setConfirmBulkArchive(true); }}>Ausgewählte archivieren</button>
        <details className="board-bulk-more">
          <summary>Weitere Aktion</summary>
          <div className="board-bulk-more-body">
            <label>Priorität <select aria-label="Priorität für ausgewählte Karten" value={bulkPriority} disabled={bulkBusy || snapshot.queue?.state === 'running'} onChange={(event) => { setBulkPriority(event.target.value as CardPriority | ''); setConfirmBulkPriority(null); }}>
              <option value="">Bitte wählen</option>
              {CARD_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select></label>
            <button className="secondary-button small" type="button" disabled={!bulkPriorityCount || bulkBusy || snapshot.queue?.state === 'running'} onClick={() => {
              if (!bulkPriority || !bulkPriorityCount) return;
              setConfirmBulkArchive(false);
              setConfirmBulkPriority({ cardIds: selectedBulkCards.map((card) => card.id), priority: bulkPriority, changeCount: bulkPriorityCount });
            }}>Priorität prüfen</button>
            {bulkPriority && !bulkPriorityCount ? <span className="board-bulk-note">Alle ausgewählten Karten haben diese Priorität bereits.</span> : null}
          </div>
        </details>
      </> : null}
      {selectedBulkCards.length ? <span className="board-bulk-note">Sammelverschieben startet keine Spaltenagenten.</span> : null}
      {selectableCards.length > 100 ? <span role="status">Maximal 100 Karten pro Sammelaktion; bitte zuerst filtern.</span> : null}
      {snapshot.queue?.state === 'running' ? <span role="status">Warteschlange vor Sammelaktionen pausieren.</span> : null}
    </div> : null}
    {confirmBulkArchive && selectedBulkCards.length ? <BulkArchiveConfirmation count={selectedBulkCards.length} busy={bulkBusy} onConfirm={() => void applyBulk('archive')} onCancel={() => setConfirmBulkArchive(false)} /> : null}
    {confirmBulkPriority ? <BulkPriorityConfirmation selectedCount={confirmBulkPriority.cardIds.length} changeCount={confirmBulkPriority.changeCount} priorityLabel={CARD_PRIORITIES.find((item) => item.value === confirmBulkPriority.priority)?.label ?? confirmBulkPriority.priority} busy={bulkBusy} onConfirm={() => void applyBulkPriority()} onCancel={() => setConfirmBulkPriority(null)} /> : null}
    {bulkNotice ? <p className="board-bulk-result" role="status">{bulkNotice}</p> : null}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <div className="board-scroll"><div className="board-columns">
      {visibleColumns.map((column, index) => <BoardColumn key={column.id} column={column} columns={columns} cards={visibleCards.filter((card) => card.columnId === column.id).sort(compareCardOrder)} snapshot={snapshot} workflowEvidence={workflowEvidence} emptyMessage={boardEmptyMessage(index, hasActiveCards, filtersActive)} onSelect={openBoardCard} onOpenSession={(id) => openBoardCard(id, true)} onAnnounce={setAnnouncement} onMove={moveCard} onReorder={reorderCard} onReorderColumn={reorderColumn} onDrop={onDrop} onCreate={() => { setCreatingIn(column.id); setTitle(''); }} canCreate={visibility !== 'archived'} mutate={mutate} bulkMode={bulkMode} bulkIds={bulkIds} onToggleBulk={toggleBulk}>
        {creatingIn === column.id && visibility !== 'archived' ? <form className="new-card-form" onSubmit={(event) => void addCard(event, column.id)}><input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aufgabe benennen…" aria-label="Neue Karte" /><div className="inline-actions"><button className="primary-button small" type="submit">Hinzufügen</button><button className="icon-button" type="button" onClick={() => setCreatingIn(null)} aria-label="Abbrechen"><X size={15} /></button></div></form> : null}
      </BoardColumn>)}
      {visibility !== 'archived' && !filterColumnId ? <form className="new-column-form" onSubmit={(event) => void addColumn(event)}><span><Plus size={17} /> Spalte hinzufügen</span><input value={newColumn} onChange={(event) => setNewColumn(event.target.value)} placeholder="Spaltenname" aria-label="Neue Spalte" maxLength={80} required /><button className="secondary-button small" type="submit">Erstellen</button></form> : null}
    </div></div>
    <BoardDependencyTrace projectId={snapshot.project.id} cards={snapshot.cards} onOpenCard={openBoardCard} />
    <BoardSessionDock key={snapshot.project.id} snapshot={snapshot} onOpenSession={(cardId, sessionId) => openBoardCard(cardId, true, sessionId)} />
    {selected ? <CardPanel card={selected} snapshot={snapshot} mutate={mutate} onClose={closeBoardCard} onOpenCard={openBoardCard} onOpenDesign={onOpenDesign} onOpenBrowser={onOpenBrowser} focusSession={focusSession} focusSessionId={focusSessionId} focusReviewComment={openCard?.id === selected.id && openCard.reviewCommentId ? { id: openCard.reviewCommentId, token: openCard.token } : null} focusQaReport={openCard?.id === selected.id && openCard.qaReportId ? { id: openCard.qaReportId, token: openCard.token } : null} /> : null}
    {showTaskDraft ? <TaskDraftAssistant key={snapshot.project.id} snapshot={snapshot} mutate={mutate} onClose={() => setShowTaskDraft(false)} onCreated={(card) => { setShowTaskDraft(false); openBoardCard(card.id); }} /> : null}
    {showImport ? <TrelloImportPanel key={snapshot.project.id} projectId={snapshot.project.id} columns={columns} mutate={mutate} onClose={() => setShowImport(false)} /> : null}
  </div>;
}

export function BulkArchiveConfirmation({ count, busy, onConfirm, onCancel }: { count: number; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <div className="board-bulk-confirm" role="group" aria-label="Archivierung bestätigen"><strong>{count} Karten archivieren?</strong><span>Die Karten bleiben im Archiv wiederherstellbar.</span><button className="primary-button small" type="button" disabled={busy} onClick={onConfirm}>Archivierung bestätigen</button><button className="secondary-button small" type="button" disabled={busy} onClick={onCancel}>Abbrechen</button></div>;
}

export function BulkPriorityConfirmation({ selectedCount, changeCount, priorityLabel, busy, onConfirm, onCancel }: { selectedCount: number; changeCount: number; priorityLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <div className="board-bulk-confirm" role="group" aria-label="Prioritätsänderung bestätigen">
    <strong>{selectedCount} {selectedCount === 1 ? 'Karte' : 'Karten'} auf „{priorityLabel}“ setzen?</strong>
    <span>{changeCount} davon {changeCount === 1 ? 'ändert sich' : 'ändern sich'}. Kein Agent wird gestartet.</span>
    <button className="primary-button small" type="button" disabled={busy} onClick={onConfirm}>Priorität setzen</button>
    <button className="secondary-button small" type="button" disabled={busy} onClick={onCancel}>Abbrechen</button>
  </div>;
}

function compareCardOrder(a: Card, b: Card): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function BoardColumn({ column, columns, cards, snapshot, workflowEvidence, emptyMessage, onSelect, onOpenSession, onAnnounce, onMove, onReorder, onReorderColumn, onDrop, onCreate, canCreate, mutate, bulkMode, bulkIds, onToggleBulk, children }: {
  column: Column; columns: Column[]; cards: Card[]; snapshot: ProjectSnapshot; workflowEvidence: Record<string, WorkflowRunEvidence>; emptyMessage: string | null; onSelect: (id: string) => void; onOpenSession: (id: string) => void; onAnnounce: (message: string) => void;
  onMove: (card: Card, columnId: string) => Promise<boolean>;
  onReorder: (card: Card, direction: 'up' | 'down') => Promise<void>;
  onReorderColumn: (column: Column, direction: 'left' | 'right') => Promise<void>;
  onDrop: (event: React.DragEvent<HTMLElement>, columnId: string) => void;
  onCreate: () => void; canCreate: boolean; mutate: Mutate; bulkMode: boolean; bulkIds: Set<string>; onToggleBulk: (id: string) => void; children: React.ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const renameLocked = column.name.trim().toLocaleLowerCase('de-DE') === 'to do' && (snapshot.queue?.state ?? 'off') !== 'off';
  const hasCards = snapshot.cards.some((item) => item.columnId === column.id);
  const inWorkflow = snapshot.workflows.some((item) => item.steps.some((step) => step.columnId === column.id));
  const deleteReason = columns.length <= 1 ? 'Letzte Spalte' : hasCards ? 'Spalte enthält aktive oder archivierte Karten' : inWorkflow ? 'Spalte wird in einem Workflow verwendet' : renameLocked ? 'To-Do-Spalte erst nach Ausschalten der Warteschlange löschen' : '';
  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsTrigger.current?.focus());
  }
  const activeOrder = snapshot.cards.filter((card) => card.columnId === column.id && !card.archivedAt).sort(compareCardOrder);
  const columnAgent = snapshot.agents.find((item) => item.id === column.agentId);
  return <section className="board-column" data-tint={column.tint ?? 'default'} data-run-mode={column.agentId ? column.autoStart ? 'automatic' : 'manual-agent' : 'manual'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, column.id)} aria-label={`Spalte ${column.name}`}>
    <header className="column-header"><div className="column-heading"><div className="column-title"><span className="column-indicator" /><h3>{column.name}</h3><span className="count-pill">{cards.length}</span></div>{columnAgent ? <span className="column-run-summary">{columnAgent.name} · {column.autoStart ? 'Start beim Verschieben' : 'Start auf Anfrage'}</span> : null}</div><button ref={settingsTrigger} className="column-settings-trigger" type="button" aria-label={`Spalte ${column.name} einstellen`} aria-haspopup="dialog" aria-expanded={settingsOpen} title="Spalte einstellen" onClick={() => setSettingsOpen(true)}><Pencil size={16} aria-hidden="true" /></button></header>
    <div className="column-body">
      {cards.map((card) => {
        const index = activeOrder.findIndex((item) => item.id === card.id);
        return <BoardCard key={card.id} card={card} column={column} columns={columns} snapshot={snapshot} workflowSignal={cardWorkflowSignal(card.id, snapshot.workflows, workflowEvidence)} onSelect={onSelect} onOpenSession={onOpenSession} onAnnounce={onAnnounce} onMove={onMove} onReorder={onReorder} bulkMode={bulkMode} bulkSelected={bulkIds.has(card.id)} onToggleBulk={onToggleBulk} previousTitle={index > 0 ? activeOrder[index - 1]?.title : undefined} nextTitle={index >= 0 ? activeOrder[index + 1]?.title : undefined} />;
      })}
      {children}
      {cards.length === 0 && !children && emptyMessage ? <p className="empty-column">{emptyMessage}</p> : null}
    </div>
    <footer className="column-footer">{canCreate ? <button className="column-add-task" type="button" aria-label={`Karte in ${column.name} hinzufügen`} onClick={onCreate}><Plus size={17} /> Aufgabe hinzufügen</button> : null}</footer>
    {settingsOpen ? createPortal(<ColumnSettingsSheet column={column} columns={columns} snapshot={snapshot} mutate={mutate} onClose={closeSettings} onSelectCard={(id) => { setSettingsOpen(false); onSelect(id); }} onReorderColumn={onReorderColumn} renameLocked={renameLocked} deleteReason={deleteReason}><ColumnAgentSettings column={column} agents={snapshot.agents} mutate={mutate} /></ColumnSettingsSheet>, document.body) : null}
  </section>;
}

export function ColumnAgentSettings({ column, agents, mutate }: { column: Column; agents: ProjectSnapshot['agents']; mutate: Mutate }) {
  const [agentId, setAgentId] = useState(column.agentId ?? '');
  const [model, setModel] = useState(column.model ?? '');
  const [effort, setEffort] = useState<ColumnEffort | ''>(column.effort ?? '');
  useEffect(() => { setAgentId(column.agentId ?? ''); setModel(column.model ?? ''); setEffort(column.effort ?? ''); }, [column.id, column.agentId, column.model, column.effort]);
  const selectedAgent = agents.find((item) => item.id === agentId);
  const modelSupported = selectedAgent && selectedAgent.kind !== 'custom';
  const effortSupported = selectedAgent?.kind === 'codex' || selectedAgent?.kind === 'antigravity';
  const changed = agentId !== (column.agentId ?? '') || (modelSupported ? model : '') !== (column.model ?? '') || (effortSupported ? effort : '') !== (column.effort ?? '');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(() => window.studio.updateColumn({ id: column.id, agentId: agentId || null, autoStart: agentId ? column.autoStart : false, model: modelSupported ? model.trim() || null : null, effort: effortSupported && effort ? effort : null }));
  }

  return <form className="column-settings" onSubmit={(event) => void save(event)}>
    <label>Agent<select aria-label={`Agent für ${column.name}`} value={agentId} onChange={(event) => { setAgentId(event.target.value); setModel(''); setEffort(''); }}><option value="">Manueller Schritt</option>{agents.filter((item) => item.enabled || item.id === agentId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Modell<input aria-label={`Modell für ${column.name}`} value={model} maxLength={200} disabled={!modelSupported} onChange={(event) => setModel(event.target.value)} placeholder={selectedAgent?.model || 'CLI-/Profilstandard'} /></label>
    <label>Effort<select aria-label={`Effort für ${column.name}`} value={effort} disabled={!effortSupported} onChange={(event) => setEffort(event.target.value as ColumnEffort | '')}><option value="">Modellstandard</option>{COLUMN_EFFORTS.filter((item) => selectedAgent?.kind !== 'antigravity' || item.value !== 'ultra').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <small>{!selectedAgent ? 'Wähle einen Agenten. Modell und Effort bleiben sonst leer.' : selectedAgent.kind === 'custom' ? 'Eigene CLI: Modellargumente im Agentenprofil setzen.' : !effortSupported ? 'Effort ist für diesen CLI-Typ nicht verfügbar.' : `Verfügbare Effort-Stufen hängen vom gewählten ${selectedAgent.kind === 'antigravity' ? 'Antigravity' : 'Codex'}-Modell ab.`} Ein Workflow-Schritt mit einem anderen Agenten nutzt dessen Profilwerte.</small>
    <button className="secondary-button small" type="submit" disabled={!changed}>Agent-Einstellungen speichern</button>
  </form>;
}

function BoardCard({ card, column, columns, snapshot, workflowSignal, onSelect, onOpenSession, onAnnounce, onMove, onReorder, bulkMode, bulkSelected, onToggleBulk, previousTitle, nextTitle }: {
  card: Card; column: Column; columns: Column[]; snapshot: ProjectSnapshot; workflowSignal: BoardWorkflowSignal | null;
  onSelect: (id: string) => void; onOpenSession: (id: string) => void; onAnnounce: (message: string) => void; onMove: (card: Card, columnId: string) => Promise<boolean>;
  onReorder: (card: Card, direction: 'up' | 'down') => Promise<void>;
  bulkMode: boolean; bulkSelected: boolean; onToggleBulk: (id: string) => void;
  previousTitle?: string; nextTitle?: string;
}) {
  const destinations = moveDestinations(columns, card);
  const [moveOpen, setMoveOpen] = useState(false);
  const [movePosition, setMovePosition] = useState({ top: 0, left: 0 });
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '');
  const [moving, setMoving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsPosition, setActionsPosition] = useState({ top: 0, left: 0 });
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const cardButton = useRef<HTMLButtonElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const actionsPanel = useRef<HTMLDivElement>(null);
  const destinationSelect = useRef<HTMLSelectElement>(null);
  const sessions = snapshot.sessions.filter((session) => session.cardId === card.id);
  const hasWorktree = sessions.some((session) => Boolean(session.worktreePath));
  const active = sessions.some((session) => session.state === 'running');
  const runningSession = sessions.find((session) => session.state === 'running');
  const assignedAgent = snapshot.agents.find((item) => item.id === (runningSession?.agentId ?? (card.archivedAt ? null : column.agentId)));
  const destination = destinations.find((item) => item.id === destinationId);
  const destinationAgent = snapshot.agents.find((item) => item.id === destination?.agentId);
  const priority = CARD_PRIORITIES.find((item) => item.value === card.priority);

  useEffect(() => { if (moveOpen) destinationSelect.current?.focus(); }, [moveOpen]);
  useEffect(() => {
    if (!moveOpen) return;
    const closeOnScroll = () => setMoveOpen(false);
    document.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => { document.removeEventListener('scroll', closeOnScroll, true); window.removeEventListener('resize', closeOnScroll); };
  }, [moveOpen]);
  useEffect(() => {
    if (!actionsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && (actionsPanel.current?.contains(event.target) || actionsTrigger.current?.contains(event.target))) return;
      setActionsOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    const dismissOnScroll = () => setActionsOpen(false);
    document.addEventListener('scroll', dismissOnScroll, true);
    window.addEventListener('resize', dismissOnScroll);
    actionsPanel.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('scroll', dismissOnScroll, true); window.removeEventListener('resize', dismissOnScroll); };
  }, [actionsOpen]);
  useEffect(() => { if (destinations.length && !destinations.some((item) => item.id === destinationId)) setDestinationId(destinations[0]!.id); }, [columns, card.columnId, card.archivedAt, destinationId]);

  function closeMove() {
    setMoveOpen(false);
    requestAnimationFrame(() => cardButton.current?.focus());
  }

  function openMove() {
    const rect = cardButton.current?.getBoundingClientRect();
    if (rect) {
      const height = 178;
      setMovePosition({
        top: rect.bottom + 6 + height <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)),
      });
    }
    setMoveOpen(true);
  }

  async function submitMove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!destination || moving) return;
    setMoving(true);
    const moved = await onMove(card, destination.id);
    setMoving(false);
    if (moved) setMoveOpen(false);
  }

  async function submitReorder(direction: 'up' | 'down') {
    if (reordering || card.archivedAt) return;
    setReordering(true);
    try { await onReorder(card, direction); }
    finally { setReordering(false); }
  }

  function closeActions() {
    setActionsOpen(false);
    setActionError('');
    requestAnimationFrame(() => actionsTrigger.current?.focus());
  }

  async function copyCardId() {
    setActionError('');
    try {
      await window.studio.copyCardId({ projectId: snapshot.project.id, cardId: card.id });
      onAnnounce(`Karten-ID von „${card.title}“ kopiert.`);
      closeActions();
    } catch (reason) {
      setActionError(`Karten-ID konnte nicht kopiert werden: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function openWorktree() {
    if (!hasWorktree || actionBusy) return;
    setActionError('');
    setActionBusy(true);
    try {
      await window.studio.openCardWorktree({ projectId: snapshot.project.id, cardId: card.id });
      onAnnounce(`Git-Worktree von „${card.title}“ geöffnet.`);
      closeActions();
    } catch (reason) {
      setActionError(`Git-Worktree konnte nicht geöffnet werden: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { setActionBusy(false); }
  }

  return <div className={`board-card-wrap${bulkMode ? ' is-selecting' : ''}`} data-card-id={card.id}>
    {!card.archivedAt && bulkMode ? <label className="board-bulk-card-select"><input type="checkbox" checked={bulkSelected} onChange={() => onToggleBulk(card.id)} aria-label={`„${card.title}“ für Sammelaktion auswählen`} /><span className="sr-only">Auswählen</span></label> : null}
    <button ref={cardButton} id={`board-card-${card.id}`} type="button" draggable={!card.archivedAt} onDragStart={(event) => { if (!card.archivedAt) event.dataTransfer.setData('text/card-id', card.id); }} className={`task-card${card.archivedAt ? ' archived' : ''}${active ? ' is-running' : ''}`} data-priority={card.priority} aria-label={`Karte „${card.title}“ in „${column.name}“ öffnen${card.archivedAt ? ', archiviert' : ''}${active ? ', Agent läuft' : ''}`} aria-describedby={[card.description ? `board-card-description-${card.id}` : null, workflowSignal ? `board-card-workflow-${card.id}` : null].filter(Boolean).join(' ') || undefined} aria-keyshortcuts={destinations.length ? 'M' : undefined} onKeyDown={(event) => { if (destinations.length && isMoveShortcut(event)) { event.preventDefault(); openMove(); } }} onClick={() => onSelect(card.id)}>
      <span className="task-card-grip" aria-hidden="true">{card.archivedAt ? <Archive size={15} /> : <GripVertical size={15} />}</span>
      <span className="task-card-kicker"><span title={`Karten-ID: ${card.id}`}>#{card.id.slice(0, 6)}</span>{card.priority !== 'none' ? <span className={`task-card-priority-text priority-${card.priority}`}>{priority?.label ?? card.priority}</span> : null}</span>
      <strong>{card.title}</strong>
      {workflowSignal ? <BoardWorkflowMarkers cardId={card.id} signal={workflowSignal} /> : null}
      {card.archivedAt ? <span className="task-card-archive-label">Archiviert</span> : null}
      {card.labels.length > 0 ? <span className="task-card-metadata">
        {card.labels.slice(0, 3).map((label) => <span className="card-label" key={label}>{label}</span>)}
        {card.labels.length > 3 ? <span className="card-label" title={card.labels.slice(3).join(', ')}>+{card.labels.length - 3}</span> : null}
      </span> : null}
      {card.description ? <span className="task-card-description" id={`board-card-description-${card.id}`}>{card.description}</span> : null}
      {!card.archivedAt || sessions.length > 0 ? <span className="task-card-footer"><span>{active ? <><span className="live-dot" /> {assignedAgent?.name ?? 'Agent'} arbeitet</> : assignedAgent ? <><Terminal size={13} /> {assignedAgent.name} {column.autoStart ? '· Start beim Verschieben' : '· bereit'}</> : sessions.length ? <><Terminal size={13} /> Letzter Lauf beendet</> : 'Kein Agent zugewiesen'}</span>{!active && sessions.length > 0 ? <span className="task-card-run-count">{sessions.length} Lauf{sessions.length === 1 ? '' : 'e'}</span> : null}</span> : null}
    </button>
    <button ref={actionsTrigger} className="card-quick-trigger" type="button" aria-label={`Schnellaktionen für „${card.title}“`} aria-expanded={actionsOpen} aria-controls={actionsOpen ? `card-actions-${card.id}` : undefined} onKeyDown={(event) => { if (actionsOpen && event.key === 'Escape') { event.preventDefault(); closeActions(); } }} onClick={() => { setActionError(''); if (!actionsOpen) { const rect = actionsTrigger.current?.getBoundingClientRect(); if (rect) { const height = 220; const top = rect.bottom + 5 + height <= window.innerHeight ? rect.bottom + 5 : Math.max(8, rect.top - height - 5); setActionsPosition({ top, left: Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)) }); } } setActionsOpen((open) => !open); }}><MoreHorizontal size={18} aria-hidden="true" /></button>
    {actionsOpen ? createPortal(<div ref={actionsPanel} className="card-quick-actions card-quick-popover" style={actionsPosition} id={`card-actions-${card.id}`} role="group" aria-label={`Schnellaktionen für „${card.title}“`} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeActions(); } }}>
      {!card.archivedAt && destinations.length ? <button type="button" onClick={() => { setActionsOpen(false); openMove(); }}>Verschieben <kbd>M</kbd></button> : null}
      {!card.archivedAt && previousTitle ? <button type="button" disabled={reordering} onClick={() => { setActionsOpen(false); void submitReorder('up'); }}><ArrowUp size={15} aria-hidden="true" /> Vor „{previousTitle}“ setzen</button> : null}
      {!card.archivedAt && nextTitle ? <button type="button" disabled={reordering} onClick={() => { setActionsOpen(false); void submitReorder('down'); }}><ArrowDown size={15} aria-hidden="true" /> Hinter „{nextTitle}“ setzen</button> : null}
      {sessions.length ? <button type="button" onClick={() => { setActionsOpen(false); actionsTrigger.current?.focus(); onOpenSession(card.id); }}><Terminal size={15} aria-hidden="true" /> Sitzung ansehen</button> : null}
      {hasWorktree ? <button type="button" disabled={actionBusy} onClick={() => void openWorktree()}><FolderOpen size={15} aria-hidden="true" /> Worktree öffnen</button> : null}
      <button type="button" onClick={() => void copyCardId()}><Copy size={15} aria-hidden="true" /> Karten-ID kopieren</button>
      {actionError ? <p className="card-quick-error" role="alert">{actionError}</p> : null}
    </div>, document.body) : null}
    {moveOpen && destination ? createPortal(<form className="card-move-form card-move-popover" style={movePosition} id={`board-move-${card.id}`} onSubmit={(event) => void submitMove(event)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMove(); } }}><label htmlFor={`board-destination-${card.id}`}>Zielspalte für „{card.title}“</label><select ref={destinationSelect} id={`board-destination-${card.id}`} value={destinationId} disabled={moving} onChange={(event) => setDestinationId(event.target.value)}>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{destination.autoStart && destination.agentId ? <p className="card-move-warning" id={`board-move-warning-${card.id}`}>Beim Verschieben versucht Jarvis, {destinationAgent?.name ?? 'den Spaltenagenten'} automatisch zu starten.</p> : null}<div className="card-move-actions"><button className="primary-button small" type="submit" disabled={moving} aria-describedby={destination.autoStart && destination.agentId ? `board-move-warning-${card.id}` : undefined}>Nach „{destination.name}“ verschieben</button><button className="secondary-button small" type="button" onClick={closeMove} disabled={moving}>Abbrechen</button></div></form>, document.body) : null}
  </div>;
}
