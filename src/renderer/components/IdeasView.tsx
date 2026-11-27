import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, GripVertical, MessageCircle, Plus, Send } from 'lucide-react';
import type { DraftTurn } from '../../shared/task-draft';
import type { Idea, IdeaCategory, IdeaReply } from '../../shared/ideas';
import type { ProjectSnapshot } from '../../shared/types';
import type { LanguagePreference } from '../language';
import type { Mutate } from './shared';
import { TrelloImportPanel } from './TrelloImportPanel';
import { IdeaMatchPanel } from './IdeaMatchPanel';
import { ProjectViewTabs, type PlanningView } from './ProjectViewTabs';
import './ideas.css';

type Draft = Pick<Idea, 'id' | 'title' | 'body' | 'category' | 'turns' | 'cardId'>;
const emptyDraft = (): Draft => ({ id: '', title: '', body: '', category: 'idea', turns: [], cardId: null });
const labels: Record<IdeaCategory, string> = { idea: 'Idee', backlog: 'Backlog', roadmap: 'Roadmap' };
const categories: IdeaCategory[] = ['idea', 'backlog', 'roadmap'];
const signature = (value: Draft): string => JSON.stringify(value);
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const IDEA_DRAG_TYPE = 'application/x-branchloom-idea';

/** A note can be captured in one field while the existing titled idea format stays intact. */
export function titleFromNote(body: string): string {
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  return firstLine.replace(/\s+/g, ' ').slice(0, 100);
}

export function noteExcerpt(item: Pick<Idea, 'title' | 'body'>): string {
  const body = item.body.trim();
  return item.title === titleFromNote(body) ? body.split(/\r?\n/).slice(1).join('\n').trim() : body;
}

export function ideaFromDrop(ideas: Idea[], projectId: string, id: string): Idea | null {
  return ideas.find((item) => item.id === id && item.projectId === projectId) ?? null;
}

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; onOpenCard: (id: string) => void; onNavigate?: (view: PlanningView) => void; language?: LanguagePreference }

export function IdeasView({ snapshot, mutate, onOpenCard, onNavigate, language }: Props) {
  const projectId = snapshot.project.id;
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baseline, setBaseline] = useState(signature(emptyDraft()));
  const [filter, setFilter] = useState<IdeaCategory | 'all'>('all');
  const [message, setMessage] = useState('');
  const [suggestion, setSuggestion] = useState<IdeaReply | null>(null);
  const [columnId, setColumnId] = useState(snapshot.columns.find((item) => item.name.toLocaleLowerCase('de-DE') === 'to do')?.id ?? snapshot.columns[0]?.id ?? '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showTrelloImport, setShowTrelloImport] = useState(false);
  const [discussionIdeaId, setDiscussionIdeaId] = useState<string | null>(null);
  const [draggingIdeaId, setDraggingIdeaId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const messageField = useRef<HTMLTextAreaElement>(null);
  const dirty = signature(draft) !== baseline;
  const mergedIntoIdeaId = ideas.find((item) => item.id === draft.id)?.mergedIntoIdeaId ?? null;
  const visible = useMemo(() => filter === 'all' ? ideas : ideas.filter((item) => item.category === filter), [ideas, filter]);

  useEffect(() => {
    let active = true;
    const blank = emptyDraft();
    setDraft(blank); setBaseline(signature(blank)); setDiscussionIdeaId(null); setMessage(''); setSuggestion(null); setLoading(true);
    window.studio.ideas(projectId).then((items) => { if (active) setIdeas(items); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  function switchTo(item?: Idea): boolean {
    if (busy) return false;
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen an dieser Idee verwerfen?')) return false;
    const next = item ? { id: item.id, title: item.title, body: item.body, category: item.category, turns: item.turns, cardId: item.cardId } : emptyDraft();
    setDraft(next);
    setBaseline(signature(next));
    setSuggestion(null);
    setMessage('');
    setError('');
    setNotice('');
    setDiscussionIdeaId(null);
    return true;
  }

  function navigateTo(view: PlanningView) {
    if (busy || !onNavigate) return;
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen an dieser Idee verwerfen?')) return;
    onNavigate(view);
  }

  function openDiscussion(item: Idea) {
    if (item.projectId !== projectId) return;
    if (!switchTo(item)) return;
    setDiscussionIdeaId(item.id);
    requestAnimationFrame(() => messageField.current?.focus());
  }

  function dropIdea(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    setDraggingIdeaId(null);
    const id = event.dataTransfer.getData(IDEA_DRAG_TYPE);
    const item = ideaFromDrop(ideas, projectId, id);
    if (item) openDiscussion(item);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.title.trim() && !draft.body.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await window.studio.saveIdea({ projectId, id: draft.id || undefined, title: draft.title.trim() || titleFromNote(draft.body), body: draft.body, category: draft.category, turns: draft.turns });
      const next: Draft = { id: saved.id, title: saved.title, body: saved.body, category: saved.category, turns: saved.turns, cardId: saved.cardId };
      if (draft.id) { setDraft(next); setBaseline(signature(next)); }
      else { const blank = emptyDraft(); setDraft(blank); setBaseline(signature(blank)); setDiscussionIdeaId(null); }
      setNotice('Notiz lokal gespeichert.');
      setIdeas(await window.studio.ideas(projectId));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim() || !draft.id || discussionIdeaId !== draft.id) return;
    const next: DraftTurn[] = [...draft.turns.slice(-10), { role: 'user', text: message.trim() }];
    while (next.length > 1 && next.reduce((size, turn) => size + turn.text.length, 0) > 16_000) next.shift();
    setBusy(true); setError(''); setNotice('');
    try {
      const answer = await window.studio.discussIdea({ projectId, turns: next, title: draft.title, body: draft.body, category: draft.category });
      setDraft((old) => ({ ...old, turns: [...next, { role: 'assistant', text: answer.reply }] }));
      setSuggestion(answer);
      setMessage('');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function convert() {
    if (busy || !draft.id || dirty || draft.cardId || !columnId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const card = await mutate(() => window.studio.convertIdeaToCard({ projectId, ideaId: draft.id, columnId }));
      if (!card) { setError('Die Karte konnte nicht angelegt werden.'); return; }
      const refreshed = await window.studio.ideas(projectId);
      setIdeas(refreshed);
      const selected = refreshed.find((item) => item.id === draft.id);
      if (selected) {
        const next = { id: selected.id, title: selected.title, body: selected.body, category: selected.category, turns: selected.turns, cardId: selected.cardId };
        setDraft(next); setBaseline(signature(next));
      }
      setNotice('Karte angelegt. Ein Agent wurde dadurch nicht gestartet.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="ideas-page" aria-label="Ideenraum">
    <ProjectViewTabs active="ideas" onNavigate={navigateTo} disabled={busy || !onNavigate} language={language} />
    <header className="ideas-heading"><p>Schreib den Gedanken auf oder sammle Trello-Karten. Unfertiges bleibt hier, bis du daraus eine Aufgabe machst.</p><button className="text-button" type="button" onClick={() => setShowTrelloImport(true)} disabled={busy || dirty} title={dirty ? 'Speichere die aktuelle Notiz vor dem Trello-Abgleich.' : undefined}>Trello-Karten sammeln</button></header>
    <form className="ideas-editor" onSubmit={(event) => void save(event)}>
      <div className="ideas-editor-head"><h3>{draft.id ? 'Notiz bearbeiten' : 'Neue Notiz'}</h3><div className="ideas-editor-meta"><label>Bereich <select aria-label="Bereich der Notiz" value={draft.category} disabled={busy} onChange={(event) => setDraft((old) => ({ ...old, category: event.target.value as IdeaCategory }))}>{categories.map((category) => <option key={category} value={category}>{labels[category]}</option>)}</select></label>{draft.id ? <button className="text-button" type="button" disabled={busy} onClick={() => switchTo()}><Plus size={15} /> Neue Notiz</button> : null}</div></div>
      <label className="ideas-note-field"><span className="sr-only">Notiz</span><textarea rows={3} maxLength={8_000} value={draft.body} disabled={busy} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Was geht dir gerade durch den Kopf?" /></label>
      <div className="ideas-editor-foot"><details className="ideas-title-option"><summary>Kurztitel optional</summary><label>Kurztitel<input maxLength={160} value={draft.title} disabled={busy} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="Sonst nehmen wir die erste Zeile" /></label></details><span className="ideas-dirty">{dirty ? 'Noch nicht gespeichert' : draft.id ? 'Gespeichert' : ''}</span><button className="primary-button" type="submit" disabled={busy || !draft.title.trim() && !draft.body.trim()}>{draft.id ? 'Änderungen speichern' : 'Notiz festhalten'}</button></div>
      {suggestion && (suggestion.suggestedTitle || suggestion.suggestedBody) ? <div className="ideas-suggestion"><strong>Vorschlag des Agenten</strong>{suggestion.suggestedTitle ? <p>{suggestion.suggestedTitle}</p> : null}{suggestion.suggestedBody ? <small>{suggestion.suggestedBody}</small> : null}<button className="secondary-button" type="button" disabled={busy} onClick={() => { setDraft((old) => ({ ...old, title: suggestion.suggestedTitle || old.title, body: suggestion.suggestedBody || old.body, category: suggestion.suggestedCategory ?? old.category })); setSuggestion(null); }}>Vorschlag übernehmen</button></div> : null}
    </form>
    <div className="ideas-flow">
      <section className="ideas-shelf" aria-label="Gespeicherte Notizen"><div className="ideas-shelf-head"><h3>Notizen <span>{ideas.length}</span></h3><label>Zeigen <select value={filter} onChange={(event) => setFilter(event.target.value as IdeaCategory | 'all')}><option value="all">Alle</option>{categories.map((category) => <option key={category} value={category}>{labels[category]}</option>)}</select></label></div>
        {loading ? <p className="ideas-muted">Notizen werden geladen…</p> : visible.length === 0 ? <p className="ideas-muted">Hier erscheinen deine gespeicherten Notizen.</p> : <div className="ideas-note-grid">{visible.map((item) => <article className={`ideas-note ${item.id === draft.id ? 'selected' : ''} ${item.id === draggingIdeaId ? 'dragging' : ''}`} draggable={!busy} onDragStart={(event) => { event.dataTransfer.setData(IDEA_DRAG_TYPE, item.id); event.dataTransfer.effectAllowed = 'copy'; setDraggingIdeaId(item.id); }} onDragEnd={() => { setDraggingIdeaId(null); setDropActive(false); }} key={item.id}><span className="ideas-note-marker" aria-hidden="true" /><div className="ideas-note-top"><span>{labels[item.category]}</span><GripVertical size={15} aria-hidden="true" /></div><button className="ideas-note-open" type="button" disabled={busy} aria-current={item.id === draft.id ? 'true' : undefined} onClick={() => switchTo(item)}><strong>{item.title}</strong>{noteExcerpt(item) ? <span>{noteExcerpt(item)}</span> : null}</button><div className="ideas-note-foot"><small>{item.cardId ? 'Im Board' : item.mergedIntoIdeaId ? 'Verbunden' : new Date(item.updatedAt).toLocaleDateString('de-DE')}</small><button className="text-button" type="button" disabled={busy} onClick={() => openDiscussion(item)}>Weiterdenken <ArrowRight size={14} /></button></div></article>)}</div>}
      </section>
      <section className={`ideas-conversation ${dropActive ? 'drop-active' : ''}`} aria-label="Idee besprechen" onDragOver={(event) => { if (event.dataTransfer.types.includes(IDEA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }} onDrop={dropIdea}>
        <div className="ideas-conversation-head"><MessageCircle size={20} aria-hidden="true" /><h3>Weiterdenken</h3></div>
        {discussionIdeaId && draft.id === discussionIdeaId ? <><p className="ideas-conversation-subject">{draft.title}</p><div className="ideas-turns" aria-live="polite">{draft.turns.length ? draft.turns.map((turn, index) => <div className={`ideas-turn ${turn.role}`} key={`${index}-${turn.role}`}><strong>{turn.role === 'user' ? 'Du' : 'Codex'}</strong><p>{turn.text}</p></div>) : <p className="ideas-muted">Was soll an dieser Idee genauer werden?</p>}</div></> : <p className="ideas-drop-instruction">Zieh eine Notiz hierher oder nutze bei ihr „Weiterdenken“. Die Diskussion startet erst, wenn du eine Nachricht absendest.</p>}
        <form className="ideas-ask" onSubmit={(event) => void ask(event)}><label>Nachricht<textarea ref={messageField} rows={3} maxLength={4_000} value={message} disabled={busy || !discussionIdeaId || draft.id !== discussionIdeaId} onChange={(event) => setMessage(event.target.value)} placeholder="Stell eine Frage zur Notiz …" /></label><button className="secondary-button" type="submit" disabled={busy || !message.trim() || !discussionIdeaId || draft.id !== discussionIdeaId}><Send size={16} /> {busy ? 'Bitte warten…' : 'Besprechen'}</button></form>
        <details className="ideas-disclosure"><summary>Welche Daten gehen an Codex?</summary><p>„Besprechen“ sendet Gespräch, editierbaren Titel, Notizen, Bereich, Projektname und das reguläre Projekt-README (maximal 12 KB) an den unter Workflows eingestellten Codex-Agenten. Andere Projektdateien werden hier nicht mitgegeben. Antworten ändern nichts automatisch.</p></details>
      </section>
    </div>
    {draft.id ? <><section className="ideas-convert" aria-label="Ins Board übernehmen"><div><h3>Als Aufgabe ins Board</h3><p>Erst dein Klick legt eine Karte an. Ein Agent startet dadurch nicht.</p></div>{draft.cardId ? <button className="secondary-button" type="button" onClick={() => onOpenCard(draft.cardId!)}>Karte öffnen <ArrowRight size={16} /></button> : mergedIntoIdeaId ? <button className="secondary-button" type="button" onClick={() => switchTo(ideas.find((item) => item.id === mergedIntoIdeaId))}>Hauptidee öffnen <ArrowRight size={16} /></button> : <div className="ideas-convert-controls"><label>Spalte<select value={columnId} disabled={busy || dirty} onChange={(event) => setColumnId(event.target.value)}>{snapshot.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="button" onClick={() => void convert()} disabled={busy || dirty || !columnId}>Karte anlegen <ArrowRight size={16} /></button>{dirty ? <small>Speichere die Notiz zuerst.</small> : null}</div>}</section>
      <details className="ideas-similar"><summary>Ähnliche Einträge prüfen</summary><IdeaMatchPanel key={`matches-${draft.id}-${ideas.find((item) => item.id === draft.id)?.updatedAt ?? ''}`} projectId={projectId} ideaId={draft.id} dirty={dirty} onOpenIdea={(id) => { const item = ideas.find((entry) => entry.id === id); if (item) switchTo(item); }} onOpenCard={onOpenCard} onLinksChanged={async () => setIdeas(await window.studio.ideas(projectId))} /></details></> : null}
    {error ? <p role="alert" className="ideas-feedback error">{error}</p> : null}
    {notice ? <p role="status" className="ideas-feedback">{notice}</p> : null}
    {showTrelloImport ? <TrelloImportPanel key={`ideas-${projectId}`} projectId={projectId} columns={snapshot.columns} mutate={mutate} destination="ideas" onIdeasImported={async () => {
      const refreshed = await window.studio.ideas(projectId);
      setIdeas(refreshed);
      const selected = refreshed.find((item) => item.id === draft.id);
      if (selected && !dirty) {
        const next: Draft = { id: selected.id, title: selected.title, body: selected.body, category: selected.category, turns: selected.turns, cardId: selected.cardId };
        setDraft(next); setBaseline(signature(next));
      }
    }} onClose={() => setShowTrelloImport(false)} /> : null}
  </section>;
}
