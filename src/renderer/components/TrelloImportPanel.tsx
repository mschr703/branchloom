import { useEffect, useMemo, useRef, useState } from 'react';
import { FileJson2, LoaderCircle, Upload, X } from 'lucide-react';
import type { Column, TrelloBoardSummary, TrelloConnectionStatus, TrelloImportCard, TrelloImportPreview, TrelloImportResult } from '../../shared/types';
import type { TrelloIdeaComparison, TrelloIdeaImportResult } from '../../shared/types';
import type { IdeaCategory } from '../../shared/ideas';
import type { Mutate } from './shared';
import './trello-connect.css';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DISPLAY_LIMIT = 100;

export function defaultTrelloSelection(preview: TrelloImportPreview): string[] {
  return preview.cards.filter((card) => card.eligible && !card.archived && !card.importedCardId && !card.importedIdeaId).map((card) => card.sourceId);
}

export function suggestedTrelloListColumns(preview: TrelloImportPreview, columns: Column[], fallbackColumnId: string): Record<string, string> {
  const byName = new Map(columns.map((column) => [column.name.trim().toLocaleLowerCase(), column.id]));
  return Object.fromEntries(preview.cards.filter((card) => card.listId).map((card) => [card.listId!, byName.get((card.listName ?? '').trim().toLocaleLowerCase()) ?? fallbackColumnId]));
}

export function importable(card: TrelloImportCard): boolean {
  return card.eligible && !card.importedCardId && !card.importedIdeaId;
}

export function trelloCardStatus(card: TrelloImportCard): string {
  if (card.importedIdeaId && card.sourceChange === 'changed') return 'Trello-Quelle geändert';
  if (card.importedCardId) return 'Bereits importiert';
  if (card.importedIdeaId) return 'Bereits im Ideenraum';
  if (card.reason) return `Fehler: ${card.reason}`;
  return card.archived ? 'Archiviert' : 'Bereit';
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

export function TrelloCardRow({ card, checked, disabled, onToggle }: { card: TrelloImportCard; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return <label className={importable(card) ? 'trello-card-row' : 'trello-card-row unavailable'}><input type="checkbox" checked={checked} disabled={!importable(card) || disabled} onChange={onToggle} /><span><strong>{card.title || '(Ohne Titel)'}</strong><small>{card.listName ?? 'Ohne Liste'} · {trelloCardStatus(card)}</small>{card.labels.length ? <small>Labels: {card.labels.join(', ')}</small> : null}{card.labelNote ? <small>{card.labelNote}</small> : null}{card.description ? <em>{card.description.slice(0, 140)}</em> : null}</span></label>;
}

export function TrelloImportPanel({ projectId, columns, mutate, onClose, destination = 'cards', onIdeasImported }: {
  projectId: string; columns: Column[]; mutate: Mutate; onClose: () => void; destination?: 'cards' | 'ideas'; onIdeasImported?: () => Promise<void>;
}) {
  const ideasTarget = destination === 'ideas';
  const fileRequestId = useRef(0);
  const [mode, setMode] = useState<'live' | 'file'>('live');
  const [connection, setConnection] = useState<TrelloConnectionStatus | null>(null);
  const [signInAvailable, setSignInAvailable] = useState(false);
  const [key, setKey] = useState('');
  const [token, setToken] = useState('');
  const [boards, setBoards] = useState<TrelloBoardSummary[]>([]);
  const [boardId, setBoardId] = useState('');
  const [previewBoardId, setPreviewBoardId] = useState('');
  const [previewMode, setPreviewMode] = useState<'live' | 'file' | null>(null);
  const [fileName, setFileName] = useState('');
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState<TrelloImportPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [columnId, setColumnId] = useState(columns.find((column) => column.name.toLowerCase() === 'to do')?.id ?? columns[0]?.id ?? '');
  const [columnByListId, setColumnByListId] = useState<Record<string, string> | null>(null);
  const [category, setCategory] = useState<IdeaCategory>('backlog');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<'status' | 'signin' | 'read' | 'connect' | 'boards' | 'preview' | 'accept' | 'compare' | 'reconcile' | null>('status');
  const [error, setError] = useState('');
  const [result, setResult] = useState<TrelloImportResult | TrelloIdeaImportResult | null>(null);
  const [comparison, setComparison] = useState<TrelloIdeaComparison | null>(null);
  const [copyTitle, setCopyTitle] = useState(false);
  const [copyBody, setCopyBody] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const matching = useMemo(() => preview?.cards.filter((card) => `${card.title} ${card.listName ?? ''} ${card.labels.join(' ')}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())) ?? [], [preview, filter]);
  const shown = matching.slice(0, DISPLAY_LIMIT);
  const matchingCount = matching.length;
  const sourceLists = useMemo(() => [...new Map(preview?.cards.filter((card) => card.listId).map((card) => [card.listId!, card.listName ?? 'Unbenannte Liste']) ?? [])], [preview]);

  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && busy === null) onClose(); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  useEffect(() => {
    let current = true;
    void Promise.all([window.studio.trelloConnectionStatus(), window.studio.trelloSignInAvailable()]).then(async ([saved, available]) => {
      if (!current) return;
      setSignInAvailable(available);
      setConnection(saved);
      if (saved.connected) {
        const next = await window.studio.trelloBoards();
        if (current) { setBoards(next); setBoardId(next[0]?.id ?? ''); }
      }
    }).catch((reason) => { if (current) setError(messageOf(reason)); })
      .finally(() => { if (current) setBusy(null); });
    return () => { current = false; };
  }, []);

  function clearPreview() { setPreview(null); setSelectedIds([]); setColumnByListId(null); setResult(null); setComparison(null); setReconciled(false); setPreviewBoardId(''); setPreviewMode(null); setError(''); }

  async function signIn() {
    clearPreview(); setBusy('signin');
    try {
      const saved = await window.studio.signInWithTrello();
      setConnection(saved);
      const next = await window.studio.trelloBoards();
      setBoards(next); setBoardId(next[0]?.id ?? '');
    } catch (reason) {
      if (!messageOf(reason).includes('abgebrochen')) setError(messageOf(reason));
    } finally { setBusy(null); }
  }

  async function cancelSignIn() {
    try { await window.studio.cancelTrelloSignIn(); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function openAuthorization() {
    setError('');
    try { await window.studio.openTrelloAuthorization(key.trim()); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function openAppAdmin() {
    setError('');
    try { await window.studio.openTrelloAppAdmin(); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function connect() {
    setBusy('connect'); setError(''); clearPreview();
    try {
      const saved = await window.studio.connectTrello({ key: key.trim(), token: token.trim() });
      setConnection(saved); setKey(''); setToken('');
      const next = await window.studio.trelloBoards();
      setBoards(next); setBoardId(next[0]?.id ?? '');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function disconnect() {
    setBusy('connect'); setError('');
    try { await window.studio.disconnectTrello(); setConnection({ connected: false, memberName: null }); setBoards([]); setBoardId(''); clearPreview(); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function refreshBoards() {
    setBusy('boards'); setError(''); clearPreview();
    try { const next = await window.studio.trelloBoards(); setBoards(next); setBoardId(next.some((board) => board.id === boardId) ? boardId : next[0]?.id ?? ''); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const requestId = ++fileRequestId.current;
    setFileName(file?.name ?? ''); setJson(''); clearPreview(); setBusy(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError('Die Trello-Datei darf höchstens 8 MiB groß sein.'); return; }
    setBusy('read');
    try { const content = await file.text(); if (fileRequestId.current === requestId) { setJson(content); if (!content.trim()) setError('Die ausgewählte Datei ist leer.'); } }
    catch (reason) { if (fileRequestId.current === requestId) setError(`Datei konnte nicht gelesen werden: ${messageOf(reason)}`); }
    finally { if (fileRequestId.current === requestId) setBusy(null); }
  }

  async function inspect() {
    if (mode === 'file' && !json || mode === 'live' && !boardId) return;
    setBusy('preview'); setError(''); setPreview(null); setResult(null); setComparison(null); setReconciled(false);
    try {
      const selectedBoard = boardId;
      const next = ideasTarget
        ? mode === 'live' ? await window.studio.previewTrelloBoardIdeas({ projectId, boardId: selectedBoard }) : await window.studio.previewTrelloIdeas({ projectId, json })
        : mode === 'live' ? await window.studio.previewTrelloBoard({ projectId, boardId: selectedBoard }) : await window.studio.previewTrelloImport({ projectId, json });
      setPreview(next); setPreviewMode(mode); setPreviewBoardId(mode === 'live' ? selectedBoard : ''); setSelectedIds(defaultTrelloSelection(next)); setColumnByListId(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function accept() {
    if (!preview || !previewMode || previewMode === 'file' && !json || previewMode === 'live' && !previewBoardId || !ideasTarget && !columnId || selectedIds.length === 0) return;
    setBusy('accept'); setError(''); setResult(null);
    try {
      const accepted = ideasTarget
        ? previewMode === 'live'
          ? await window.studio.acceptTrelloBoardIdeas({ projectId, category, boardId: previewBoardId, fingerprint: preview.fingerprint, sourceIds: selectedIds })
          : await window.studio.acceptTrelloIdeas({ projectId, category, json, fingerprint: preview.fingerprint, sourceIds: selectedIds })
        : previewMode === 'live'
          ? await window.studio.acceptTrelloBoard({ projectId, columnId, columnByListId: columnByListId ?? undefined, boardId: previewBoardId, fingerprint: preview.fingerprint, sourceIds: selectedIds })
          : await window.studio.acceptTrelloImport({ projectId, columnId, columnByListId: columnByListId ?? undefined, json, fingerprint: preview.fingerprint, sourceIds: selectedIds });
      setResult(accepted); setSelectedIds([]);
      setComparison(null); setReconciled(false);
      if (ideasTarget) await onIdeasImported?.(); else await mutate(async () => accepted);
      const refreshed = ideasTarget
        ? previewMode === 'live' ? await window.studio.previewTrelloBoardIdeas({ projectId, boardId: previewBoardId }) : await window.studio.previewTrelloIdeas({ projectId, json })
        : previewMode === 'live' ? await window.studio.previewTrelloBoard({ projectId, boardId: previewBoardId }) : await window.studio.previewTrelloImport({ projectId, json });
      setPreview(refreshed);
      setColumnByListId((old) => old ? Object.fromEntries(Object.entries(suggestedTrelloListColumns(refreshed, columns, columnId)).map(([listId, suggested]) => [listId, old[listId] ?? suggested])) : null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function compareSource(sourceId: string) {
    if (!ideasTarget || !previewMode) return;
    setBusy('compare'); setError(''); setComparison(null); setReconciled(false);
    try {
      const next = previewMode === 'live'
        ? await window.studio.compareTrelloBoardIdea({ projectId, boardId: previewBoardId, sourceId })
        : await window.studio.compareTrelloIdea({ projectId, json, sourceId });
      setComparison(next); setCopyTitle(false); setCopyBody(false);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  async function applySource() {
    if (!comparison || !previewMode || !copyTitle && !copyBody) return;
    setBusy('reconcile'); setError(''); setReconciled(false);
    const fields = { projectId, sourceId: comparison.sourceId, fingerprint: comparison.fingerprint,
      localSignature: comparison.localSignature, copyTitle, copyBody };
    try {
      const next = previewMode === 'live'
        ? await window.studio.applyTrelloBoardIdeaSource({ ...fields, boardId: previewBoardId })
        : await window.studio.applyTrelloIdeaSource({ ...fields, json });
      await onIdeasImported?.();
      const refreshed = previewMode === 'live'
        ? await window.studio.previewTrelloBoardIdeas({ projectId, boardId: previewBoardId })
        : await window.studio.previewTrelloIdeas({ projectId, json });
      setPreview(refreshed); setComparison(next); setCopyTitle(false); setCopyBody(false); setReconciled(true);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  function toggle(sourceId: string) {
    setSelectedIds((old) => old.includes(sourceId) ? old.filter((id) => id !== sourceId) : [...old, sourceId]);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && busy === null) onClose(); }}>
    <section className="dialog wide trello-import-dialog" role="dialog" aria-modal="true" aria-labelledby="trello-import-title">
      <div className="dialog-heading"><div><small>{ideasTarget ? 'IDEEN-IMPORT' : 'BOARD-IMPORT'}</small><h2 id="trello-import-title">{ideasTarget ? 'Trello-Ideen vormerken' : 'Karten aus Trello'}</h2></div><button className="icon-button" type="button" aria-label="Schließen" disabled={busy !== null} onClick={onClose}><X size={18} /></button></div>
      <p className="field-help">Verbinde Trello einmalig und wähle ein Board. Branchloom liest Karten nur nach deinem Klick; Benachrichtigungen, Mitglieder, Kommentare und Anhänge werden nicht importiert.</p>
      <div className="trello-source-tabs" role="group" aria-label="Trello-Quelle"><button type="button" className={mode === 'live' ? 'secondary-button active' : 'secondary-button'} aria-pressed={mode === 'live'} disabled={busy !== null} onClick={() => { setMode('live'); clearPreview(); }}>Trello verbinden</button><button type="button" className={mode === 'file' ? 'secondary-button active' : 'secondary-button'} aria-pressed={mode === 'file'} disabled={busy !== null} onClick={() => { setMode('file'); clearPreview(); }}>JSON-Datei</button></div>
      {mode === 'live' ? connection?.connected ? <div className="trello-live-source"><div className="trello-account-row"><span>Verbunden: <strong>{connection.memberName}</strong></span><button className="text-button" type="button" disabled={busy !== null} onClick={() => void disconnect()}>Verbindung trennen</button></div><label>Board auswählen<select value={boardId} disabled={busy !== null || boards.length === 0} onChange={(event) => { setBoardId(event.target.value); clearPreview(); }}>{boards.length ? boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>) : <option value="">Keine offenen Boards</option>}</select></label><div className="trello-source-actions"><button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void refreshBoards()}>Boards aktualisieren</button><button className="primary-button" type="button" disabled={busy !== null || !boardId} onClick={() => void inspect()}>{busy === 'preview' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />} Board prüfen</button></div></div>
        : <div className="trello-live-source"><p className="field-help">Melde dich in deinem Browser bei Trello an und bestätige den lesenden Zugriff für Branchloom. Danach erscheinen deine Boards hier.</p><div className="trello-signin-actions"><button className="primary-button" type="button" disabled={!signInAvailable || busy !== null} onClick={() => void signIn()}>{busy === 'signin' ? <LoaderCircle size={15} className="spin" /> : null} Mit Trello anmelden</button>{busy === 'signin' ? <button className="secondary-button" type="button" onClick={() => void cancelSignIn()}>Anmeldung abbrechen</button> : null}</div>{!signInAvailable ? <p className="field-help" role="status">Für die direkte Anmeldung fehlt diesem Build noch der registrierte Branchloom-Trello-App-Key. Der eigene Schlüsselweg unten funktioniert weiterhin.</p> : null}<details className="trello-advanced"><summary>Eigener API-Key (erweitert)</summary><div className="trello-advanced-body"><p className="field-help">Falls du eine eigene Trello-App verwendest: API-Key eintragen, Lesefreigabe öffnen und den angezeigten Token hier einsetzen. Der Token bleibt verschlüsselt im lokalen App-Profil.</p><button className="text-button" type="button" disabled={busy !== null} onClick={() => void openAppAdmin()}>Trello-App-Verwaltung öffnen</button><label>Trello-API-Key<input value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy !== null} /></label><button className="secondary-button" type="button" disabled={busy !== null || !key.trim()} onClick={() => void openAuthorization()}>Lesefreigabe im Browser öffnen</button><label>Trello-Token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy !== null} /></label><button className="secondary-button" type="button" disabled={busy !== null || !key.trim() || !token.trim()} onClick={() => void connect()}>{busy === 'connect' ? <LoaderCircle size={15} className="spin" /> : null} Verbindung prüfen und speichern</button></div></details></div>
      : <div className="trello-live-source"><p className="field-help">Offline-Alternative: Wähle den JSON-Export eines einzelnen Trello-Boards. Die Datei wird nur im Arbeitsspeicher gelesen.</p><label className="trello-file-label"><FileJson2 size={19} /> JSON-Datei auswählen<input type="file" accept=".json,application/json" onChange={(event) => void readFile(event)} disabled={busy !== null} /></label>{fileName ? <p className="trello-file-name">{fileName} · maximal 8 MiB und 5.000 Karten</p> : null}<button className="secondary-button" type="button" disabled={!json || busy !== null} onClick={() => void inspect()}>{busy === 'preview' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />} Datei prüfen</button></div>}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {preview ? <div className="trello-preview">
        <div className="trello-preview-head"><div><h3>{preview.boardName ?? 'Trello-Board'}</h3><p>{preview.total} Karten · {preview.eligible} importierbar · {preview.duplicates} bereits importiert</p></div><span className="state-badge">Vorschau</span></div>
        {ideasTarget ? <label>Bereich im Ideenraum<select value={category} disabled={busy !== null} onChange={(event) => setCategory(event.target.value as IdeaCategory)}><option value="idea">Idee</option><option value="backlog">Backlog</option><option value="roadmap">Roadmap</option></select></label>
          : <><label>{columnByListId ? 'Zielspalte für Karten ohne bekannte Trello-Liste' : 'Zielspalte'}<select value={columnId} onChange={(event) => setColumnId(event.target.value)} disabled={busy !== null}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>{sourceLists.length > 0 ? <div className="trello-list-mapping"><label><input type="checkbox" checked={columnByListId !== null} disabled={busy !== null} onChange={(event) => setColumnByListId(event.target.checked ? suggestedTrelloListColumns(preview, columns, columnId) : null)} /> Trello-Listen einzeln zuordnen</label>{columnByListId ? <div className="trello-list-mapping-rows">{sourceLists.map(([listId, listName]) => { const count = preview.cards.filter((card) => card.listId === listId).length; return <label key={listId}><span>{listName} <small>({count} {count === 1 ? 'Karte' : 'Karten'})</small></span><select aria-label={`Zielspalte für Trello-Liste ${listName}`} value={columnByListId[listId] ?? columnId} disabled={busy !== null} onChange={(event) => setColumnByListId((old) => ({ ...old, [listId]: event.target.value }))}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>; })}</div> : null}</div> : null}</>}
        <p className="field-help">{ideasTarget ? 'Die Auswahl landet zuerst nur im lokalen Ideenraum. Du kannst jede Idee dort bearbeiten und später mit einem zweiten Klick ins Board übernehmen. Trello-Liste und benannte Labels stehen in den Notizen.' : `${columnByListId ? 'Die gewählten Karten kommen in die zugeordnete Zielspalte ihrer Trello-Liste.' : 'Alle gewählten Karten kommen in die gewählte Zielspalte.'} Archivierte Trello-Karten bleiben beim Import archiviert.`} Archivierte Trello-Karten sind zunächst abgewählt. Ein Import startet keine Agenten automatisch.</p>
        <div className="trello-selection-row"><span>{selectedIds.length} ausgewählt</span><button className="text-button" type="button" onClick={() => setSelectedIds([])} disabled={busy !== null || selectedIds.length === 0}>Auswahl leeren</button><button className="text-button" type="button" onClick={() => setSelectedIds((old) => [...new Set([...old, ...shown.filter(importable).map((card) => card.sourceId)])])} disabled={busy !== null || shown.length === 0}>Angezeigte auswählen</button></div>
        <label className="sr-only" htmlFor="trello-filter">Karten filtern</label><input id="trello-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Karten, Liste oder Label filtern…" />
        <div className="trello-card-list" aria-label="Trello-Karten in der Vorschau">{shown.map((card) => <div className="trello-preview-item" key={card.sourceId}>
          <TrelloCardRow card={card} checked={selectedIds.includes(card.sourceId)} disabled={busy !== null} onToggle={() => toggle(card.sourceId)} />
          {ideasTarget && card.importedIdeaId ? <button className="text-button" type="button" disabled={busy !== null} onClick={() => void compareSource(card.sourceId)}>Quelle und Idee vergleichen</button> : null}
        </div>)}{matchingCount === 0 ? <p className="list-empty">Keine Karten für diesen Filter.</p> : null}</div>
        {matchingCount > shown.length ? <p className="field-help">{matchingCount - shown.length} weitere Karten. Filtere nach Titel oder Liste, um sie einzeln zu prüfen.</p> : null}
        {comparison ? <section className="trello-source-comparison" aria-label="Trello-Quellenvergleich">
          <div className="trello-compare-heading"><div><h4>Quelle und lokale Idee</h4><p>{comparison.sourceChange === 'changed' ? 'Die Trello-Quelle hat sich seit der letzten Übernahme geändert.' : comparison.sourceChange === 'same' ? 'Die Trello-Quelle ist seit der letzten Übernahme unverändert.' : 'Für diese ältere Idee fehlt ein gespeicherter Quellstand.'} {comparison.localChange === 'changed' ? 'Die lokale Idee wurde ebenfalls bearbeitet.' : comparison.localChange === 'unknown' ? 'Frühere lokale Änderungen lassen sich nicht sicher erkennen.' : ''}</p></div><button className="text-button" type="button" disabled={busy !== null} onClick={() => setComparison(null)}>Vergleich schließen</button></div>
          <div className="trello-compare-columns"><div><h5>Trello jetzt</h5><strong>{comparison.sourceTitle}</strong><pre>{comparison.sourceBody}</pre></div><div><h5>Lokale Idee</h5><strong>{comparison.localTitle}</strong><pre>{comparison.localBody}</pre></div></div>
          {comparison.ideaCardId ? <p className="field-help">Diese Idee wurde bereits zur Board-Karte. Eine Quellenübernahme ändert nur die Idee; die Karte bleibt unverändert.</p> : null}
          {!comparison.eligible ? <p className="inline-error" role="alert">{comparison.reason ?? 'Diese Quelle kann derzeit nicht übernommen werden.'}</p> : <div className="trello-compare-actions"><label><input type="checkbox" checked={copyTitle} disabled={busy !== null} onChange={(event) => setCopyTitle(event.target.checked)} /> Titel aus Trello übernehmen</label><label><input type="checkbox" checked={copyBody} disabled={busy !== null} onChange={(event) => setCopyBody(event.target.checked)} /> Notizen aus Trello übernehmen</label><button className="primary-button" type="button" disabled={busy !== null || !copyTitle && !copyBody} onClick={() => void applySource()}>Ausgewählte Felder übernehmen</button></div>}
          {reconciled ? <p role="status">Die ausgewählten Felder wurden in der lokalen Idee aktualisiert.</p> : null}
        </section> : null}
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busy !== null} onClick={onClose}>Abbrechen</button><button className="primary-button" type="button" disabled={busy !== null || !ideasTarget && !columnId || selectedIds.length === 0} onClick={() => void accept()}>{busy === 'accept' ? <LoaderCircle size={15} className="spin" /> : null} {selectedIds.length} {ideasTarget ? 'Ideen vormerken' : 'Karten importieren'}</button></div>
      </div> : null}
      {result ? <p className="trello-import-result" role="status">{result.created.length} {ideasTarget ? 'Ideen vorgemerkt' : 'Karten importiert'}. {result.skippedDuplicateIds.length} inzwischen vorhandene Duplikate übersprungen.</p> : null}
    </section>
  </div>;
}
