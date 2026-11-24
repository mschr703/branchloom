import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BrainCircuit, Download, Eye, Link2, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { MemoryNote, MemoryVaultImportPreview, ProjectSnapshot } from '../../shared/types';
import { backlinks, graphScope, layoutFocusedNotes, layoutNetworkNotes, linkedIdsForBody, noteEdges, type GraphScope } from '../memory-graph';
import { MemoryMarkdown, memoryMarkdownFileName, parseMemoryMarkdownFile, serializeMemoryNote } from '../memory-markdown';
import { emptyNoteNavigation, filterMemoryNotes, nextMemoryNote, openMemoryNote, previousMemoryNote } from '../memory-navigation';
import { sourceSessionIdFromNote } from '../activity-transcript';
import type { Mutate } from './shared';
import { MemoryVaultImportDialog } from './MemoryVaultImportDialog';
import { MemoryGitSourcePanel } from './MemoryGitSourcePanel';
import { ProjectKnowledgeIndex } from './ProjectKnowledgeIndex';
import '../memory.css';
import '../memory-workspace.css';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openNote?: { id: string; token: number } | null; onOpenSession?: (id: string) => void; onOpenCard?: (id: string) => void }

export function MemoryView({ snapshot, mutate, openNote, onOpenSession, onOpenCard }: Props) {
  const [query, setQuery] = useState('');
  const [navigation, setNavigation] = useState(emptyNoteNavigation);
  const selectedId = navigation.currentId;
  const [activeTag, setActiveTag] = useState('');
  const [graphMode, setGraphMode] = useState<'focus' | 'all'>('all');
  const [draft, setDraft] = useState({ title: '', body: '', tags: '' });
  const [newNote, setNewNote] = useState(false);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [importError, setImportError] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportPending, setExportPending] = useState(false);
  const [vaultPreview, setVaultPreview] = useState<MemoryVaultImportPreview | null>(null);
  const [vaultSelection, setVaultSelection] = useState<Set<string>>(new Set());
  const [vaultPending, setVaultPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const notes = useMemo(() => [...snapshot.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [snapshot.notes]);
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const sourceSessionId = selected ? sourceSessionIdFromNote(selected) : null;
  const shown = useMemo(() => filterMemoryNotes(notes, query, activeTag), [notes, query, activeTag]);
  const scope = useMemo(() => graphScope(notes, selectedId, graphMode), [notes, selectedId, graphMode]);
  const showNoteGraph = useMemo(() => noteEdges(notes).length > 0, [notes]);
  const tags = useMemo(() => [...new Set(notes.flatMap((note) => note.tags))].sort((a, b) => a.localeCompare(b, 'de-DE')), [notes]);

  function selectNote(id: string) { setNavigation((old) => openMemoryNote(old, id)); setGraphMode('focus'); }

  useLayoutEffect(() => {
    setNavigation(emptyNoteNavigation());
    setActiveTag('');
    setGraphMode('all');
    setQuery('');
    setImportError('');
    setExportMessage('');
    setVaultPreview(null);
    setVaultSelection(new Set());
  }, [snapshot.project.id]);

  useEffect(() => {
    if (openNote && notes.some((note) => note.id === openNote.id)) {
      setQuery('');
      setNavigation((old) => openMemoryNote(old, openNote.id));
      setGraphMode('focus');
    }
  }, [openNote?.id, openNote?.token, snapshot.project.id]);

  useEffect(() => {
    if (!selected) return;
    setDraft({ title: selected.title, body: selected.body, tags: selected.tags.join(', ') });
    setNewNote(false);
    setMode('preview');
  }, [selected?.id]);

  function beginNew() {
    setNavigation(emptyNoteNavigation());
    setGraphMode('all');
    setNewNote(true);
    setMode('edit');
    setDraft({ title: '', body: '', tags: '' });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await mutate(() => window.studio.saveNote({
      projectId: snapshot.project.id,
      id: selected?.id,
      title: draft.title.trim(),
      body: draft.body,
      tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      links: linkedIdsForBody(draft.body, notes).filter((id) => id !== selected?.id),
    }));
    if (saved) { selectNote(saved.id); setNewNote(false); setMode('preview'); }
  }

  async function remove() {
    if (!selected || !window.confirm(`„${selected.title}“ löschen?`)) return;
    const removed = await mutate(() => window.studio.deleteNote(selected.id));
    if (removed !== null) { setNavigation(emptyNoteNavigation()); setNewNote(false); }
  }

  async function importMarkdown(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      if (!/\.md$/i.test(file.name) || file.size > 500_000) throw new Error('Bitte eine Markdown-Datei bis 500 KB auswählen.');
      const parsed = parseMemoryMarkdownFile(file.name, await file.text());
      setNavigation(emptyNoteNavigation());
      setNewNote(true);
      setMode('edit');
      setDraft({ title: parsed.title, body: parsed.body, tags: parsed.tags.join(', ') });
      setImportError('');
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function exportMarkdown() {
    if (!selected) return;
    const blob = new Blob([serializeMemoryNote(selected)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = memoryMarkdownFileName(selected.title);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function exportVault() {
    if (exportPending || notes.length === 0) return;
    setExportPending(true);
    setImportError('');
    setExportMessage('');
    try {
      const result = await window.studio.exportMemoryVault(snapshot.project.id);
      if (result) setExportMessage(`${result.count} Notizen exportiert: ${result.directory}`);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExportPending(false);
    }
  }

  async function previewVaultImport() {
    if (vaultPending) return;
    setImportError('');
    setExportMessage('');
    try {
      const preview = await window.studio.previewMemoryVaultImport(snapshot.project.id);
      if (!preview) return;
      setVaultPreview(preview);
      setVaultSelection(new Set(preview.files.filter((file) => file.eligible).map((file) => file.key)));
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function acceptVaultImport() {
    if (!vaultPreview || vaultPending || vaultSelection.size === 0) return;
    setVaultPending(true);
    setImportError('');
    try {
      const result = await mutate(() => window.studio.acceptMemoryVaultImport({ projectId: snapshot.project.id, token: vaultPreview.token, keys: [...vaultSelection] }));
      if (result) {
        setVaultPreview(null);
        setVaultSelection(new Set());
        setExportMessage(`${result.count} Notizen aus dem Vault importiert.`);
      }
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setVaultPending(false); }
  }

  return <div className="standard-page memory-page">
    <ProjectKnowledgeIndex snapshot={snapshot} onOpenCard={onOpenCard} onOpenSession={onOpenSession} />
    <div className="view-header">
      <div><h2>Eigene Notizen</h2><p>Halte eigene Entscheidungen und Kontext fest. Verweise mit <code>[[Notiztitel]]</code> sind optional.</p></div>
      <div className="memory-header-actions">
        <details className="memory-transfer"><summary>Import &amp; Export</summary><div>
          <input ref={fileInputRef} className="sr-only" type="file" accept=".md,text/markdown" aria-label="Markdown-Datei auswählen" onChange={(event) => void importMarkdown(event)} />
          <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Markdown importieren</button>
          <button className="secondary-button" type="button" disabled={vaultPending} onClick={() => void previewVaultImport()}><Upload size={16} /> Vault-Ordner importieren</button>
          <button className="secondary-button" type="button" disabled={!notes.length || exportPending} onClick={() => void exportVault()}><Download size={16} /> {exportPending ? 'Export läuft…' : 'Alle Notizen exportieren'}</button>
        </div></details>
        <button className="primary-button" type="button" onClick={beginNew}><Plus size={17} /> Neue Notiz</button>
      </div>
    </div>
    {importError ? <p className="inline-error" role="alert">{importError}</p> : null}
    {exportMessage ? <p className="memory-vault-feedback" role="status">{exportMessage}</p> : null}
    {vaultPreview ? <MemoryVaultImportDialog preview={vaultPreview} selected={vaultSelection} busy={vaultPending} onToggle={(key) => setVaultSelection((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} onAll={(all) => setVaultSelection(new Set(all ? vaultPreview.files.filter((file) => file.eligible).map((file) => file.key) : []))} onClose={() => setVaultPreview(null)} onImport={() => void acceptVaultImport()} /> : null}
    {tags.length ? <div className="memory-tag-filter" aria-label="Notizen nach Tag filtern"><button className={activeTag ? '' : 'active'} type="button" aria-pressed={!activeTag} onClick={() => setActiveTag('')}>Alle</button>{tags.map((tag) => <button className={activeTag === tag ? 'active' : ''} key={tag} type="button" aria-pressed={activeTag === tag} onClick={() => setActiveTag(tag)}>#{tag}</button>)}</div> : null}
    <div className={showNoteGraph ? 'memory-layout' : 'memory-layout without-note-graph'}>
      <aside className="memory-list">
        <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Memory durchsuchen…" aria-label="Memory durchsuchen" /></label>
        <div className="memory-list-items">
          {shown.map((note) => <button key={note.id} type="button" className={selectedId === note.id ? 'memory-item selected' : 'memory-item'} aria-current={selectedId === note.id ? 'true' : undefined} onClick={() => selectNote(note.id)}><strong>{note.title}</strong><span>{note.body.slice(0, 92) || 'Keine Beschreibung'}</span><small>{note.tags.slice(0, 3).join(' · ') || new Date(note.updatedAt).toLocaleDateString('de-DE')}</small></button>)}
          {shown.length === 0 ? <p className="list-empty">{notes.length === 0 ? 'Noch keine Notizen.' : 'Keine Treffer.'}</p> : null}
        </div>
      </aside>
      {showNoteGraph ? <section className="graph-panel" aria-label="Manuelle Notizverknüpfungen">
        <div className="graph-header"><div><h3>Notizverweise</h3><span>{scope.notes.length} Notizen · {scope.edges.length} Verweise{scope.hiddenCount ? ` · ${scope.hiddenCount} weitere` : ''}</span></div>
          <div className="graph-modes" role="group" aria-label="Graphansicht"><button type="button" aria-pressed={graphMode === 'all'} onClick={() => setGraphMode('all')}>Alle</button><button type="button" aria-pressed={graphMode === 'focus'} disabled={!selectedId} onClick={() => setGraphMode('focus')}>Umgebung</button></div>
        </div>
        <MemoryGraph scope={scope} selectedId={selectedId} onSelect={selectNote} />
        {scope.focused && scope.edges.length === 0 ? <p className="graph-caption">Diese Notiz hat noch keine Verknüpfung. Schreibe <code>[[Notiztitel]]</code> in eine Notiz, um eine Verbindung anzulegen.</p> : null}
      </section> : null}
      <div className="memory-main">
        {newNote || selected ? <>
          <div className="memory-modebar">
            <span>{newNote ? 'NEUE NOTIZ' : mode === 'preview' ? 'NOTIZ ANSEHEN' : 'NOTIZ BEARBEITEN'}</span>
            <div>
              <button className="icon-button" type="button" disabled={!navigation.back.length} aria-label="Vorherige Notiz" title="Vorherige Notiz" onClick={() => setNavigation(previousMemoryNote)}><ArrowLeft size={16} /></button>
              <button className="icon-button" type="button" disabled={!navigation.forward.length} aria-label="Nächste Notiz" title="Nächste Notiz" onClick={() => setNavigation(nextMemoryNote)}><ArrowRight size={16} /></button>
              {selected ? <button className="secondary-button small" type="button" onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}>{mode === 'preview' ? <Pencil size={14} /> : <Eye size={14} />}{mode === 'preview' ? 'Bearbeiten' : 'Vorschau'}</button> : null}
              {selected && mode === 'preview' ? <button className="secondary-button small" type="button" onClick={exportMarkdown}><Download size={14} /> .md</button> : null}
              {sourceSessionId && onOpenSession ? <button className="secondary-button small" type="button" onClick={() => onOpenSession(sourceSessionId)}><ArrowUpRight size={14} /> Quellverlauf öffnen</button> : null}
              {selected ? <button className="icon-button danger-icon" type="button" aria-label="Notiz löschen" onClick={() => void remove()}><Trash2 size={17} /></button> : null}
            </div>
          </div>
          {mode === 'preview' && selected ? <div className="memory-preview">
            <h2>{selected.title}</h2>
            <MemoryMarkdown body={draft.body} notes={notes} onOpenNote={selectNote} />
            {selected.tags.length ? <div className="memory-preview-tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
            <MemoryGitSourcePanel projectId={snapshot.project.id} noteId={selected.id} />
          </div> : <form className="memory-editor" onSubmit={(event) => void save(event)}>
            <input className="memory-title" value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="Titel der Notiz" aria-label="Titel der Notiz" required maxLength={120} />
            <label className="field-label">Text<textarea className="memory-body" value={draft.body} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Gedanken, Entscheidungen, Kontext… Verknüpfe mit [[Notiztitel]]." rows={10} /></label>
            <label className="field-label">Tags (Komma getrennt)<input value={draft.tags} onChange={(event) => setDraft((old) => ({ ...old, tags: event.target.value }))} placeholder="Projekt, Idee, Entscheidung" /></label>
            <div className="memory-editor-actions"><span>Gespeichert wird lokal für dieses Projekt.</span><button className="primary-button" type="submit">Notiz speichern</button></div>
          </form>}
          {selected ? <div className="backlinks"><h3><Link2 size={16} /> Verknüpft von</h3>{backlinks(notes, selected.id).length ? backlinks(notes, selected.id).map((note) => <button key={note.id} type="button" onClick={() => selectNote(note.id)}>{note.title}</button>) : <p>Noch keine Rückverweise.</p>}</div> : null}
        </> : <div className="feature-empty memory-empty"><BrainCircuit size={30} /><h3>{notes.length ? 'Wähle eine Notiz' : 'Dein Wissen bekommt Struktur'}</h3><p>{notes.length ? 'Öffne eine Notiz links oder nutze die Karte, um Zusammenhänge zu erkunden.' : 'Lege deine erste Notiz an und verknüpfe später weitere mit doppelten eckigen Klammern.'}</p><button className="secondary-button" type="button" onClick={beginNew}>Notiz anlegen</button></div>}
      </div>
    </div>
  </div>;
}

function MemoryGraph({ scope, selectedId, onSelect }: { scope: GraphScope; selectedId: string | null; onSelect: (id: string) => void }) {
  const nodes = scope.focused ? layoutFocusedNotes(scope.notes) : layoutNetworkNotes(scope.notes, scope.edges);
  const positions = new Map(nodes.map((node) => [node.id, node]));
  if (nodes.length === 0) return <div className="graph-empty">Sobald Notizen vorhanden sind, erscheinen sie hier als verknüpfbarer Graph.</div>;
  return <svg className={nodes.length > 12 ? 'memory-graph dense' : 'memory-graph'} viewBox="0 0 640 400" role="group" aria-label={`Wissensgraph mit ${nodes.length} Notizen und ${scope.edges.length} Verweisen`}>
    {scope.edges.map((edge) => { const from = positions.get(edge.from)!; const to = positions.get(edge.to)!; return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="graph-edge" />; })}
    {nodes.map((node) => <g key={node.id} className={selectedId === node.id ? 'graph-node selected' : 'graph-node'} role="button" tabIndex={0} aria-label={`Notiz ${node.title} öffnen`} onClick={() => onSelect(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } }}><title>{node.title}</title><circle cx={node.x} cy={node.y} r={selectedId === node.id ? 19 : 15} /><text x={node.x} y={node.y + 34} textAnchor="middle">{node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title}</text></g>)}
  </svg>;
}
