import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, MessageCircle, Moon, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Sun, Upload, X } from 'lucide-react';
import type { Project, ProjectOrganization, ProjectPackagePreview, ProjectSnapshot, Session } from '../shared/types';
import { BoardView } from './components/BoardView';
import { IdeasView } from './components/IdeasView';
import { AgentView } from './components/AgentView';
import { ProjectSettingsView } from './components/ProjectSettingsView';
import { CommandTerminalView } from './components/CommandTerminalView';
import { MilestonesView } from './components/MilestonesView';
import { SearchPalette } from './components/SearchPalette';
import { ActivityView } from './components/ActivityView';
import { DecisionInbox } from './components/DecisionInbox';
import { ChangelogView } from './components/ChangelogView';
import { ProjectPackageDialog } from './components/ProjectPackageDialog';
import { ProjectFolderField } from './components/ProjectFolderField';
import { BranchloomMark } from './components/BranchloomMark';
import { sessionMemoryDraft } from './activity-transcript';
import { viewForSearchKind, type ProjectSearchResult, type SearchKind } from './project-search';
import { currentTheme, persistTheme, themeToggleLabel, type ThemePreference } from './theme';
import { decisionNavigationStatus, useReviewInboxIndicator } from './decision-navigation';
import type { ProjectConflictRadarResult } from '../shared/conflict-radar';
import type { GlobalInboxItem } from '../shared/global-inbox';
import { ProjectConflictBanner } from './components/ProjectConflictBanner';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { projectNavigationStatus, WorkspaceNavigation, views, type View } from './components/WorkspaceNavigation';
import { startConflictRadarRefresh } from './conflict-radar-schedule';
import { savePreparedChatCanvasNode } from './project-chat-canvas';
import './theme.css';
import './brand.css';
import './project-chat-dock.css';
import './first-run.css';
import './signals.css';

const WhiteboardView = lazy(() => import('./components/WhiteboardView').then((module) => ({ default: module.WhiteboardView })));
const WorkflowView = lazy(() => import('./components/WorkflowView').then((module) => ({ default: module.WorkflowView })));
const MemoryView = lazy(() => import('./components/MemoryView').then((module) => ({ default: module.MemoryView })));
const ProjectChat = lazy(() => import('./components/ProjectChat').then((module) => ({ default: module.ProjectChat })));
const BrowserView = lazy(() => import('./components/BrowserView').then((module) => ({ default: module.BrowserView })));
const DesignInspectionView = lazy(() => import('./components/DesignInspectionView').then((module) => ({ default: module.DesignInspectionView })));

type NavigationTarget = { kind: SearchKind; id: string; token: number; reviewCommentId?: string; qaReportId?: string };

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectOrganization, setProjectOrganization] = useState<ProjectOrganization>({ groups: [], assignments: {}, sort: 'name' });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [view, setView] = useState<View>('board');
  const [chatDockOpen, setChatDockOpen] = useState(false);
  const [whiteboardOpenNodeId, setWhiteboardOpenNodeId] = useState<string | null>(null);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;
  useEffect(() => { setWhiteboardOpenNodeId(null); }, [projectId]);
  const [designCardId, setDesignCardId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const projectMenuRef = useRef<HTMLDetailsElement>(null);
  const [newProject, setNewProject] = useState({ name: '', path: '' });
  const [importPreview, setImportPreview] = useState<ProjectPackagePreview | null>(null);
  const [importTarget, setImportTarget] = useState({ name: '', path: '' });
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
  const [openPlan, setOpenPlan] = useState<{ id: string; token: number } | null>(null);
  const [pendingGlobalItem, setPendingGlobalItem] = useState<GlobalInboxItem | null>(null);
  const reviewIndicator = useReviewInboxIndicator(projectId);
  const [queueNavigationToken, setQueueNavigationToken] = useState(0);
  const [theme, setTheme] = useState<ThemePreference>(currentTheme);
  const [projectRadar, setProjectRadar] = useState<ProjectConflictRadarResult | null>(null);
  const [projectRadarBusy, setProjectRadarBusy] = useState(false);
  const radarGeneration = useRef(0);
  const radarInFlight = useRef(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const viewAreaRef = useRef<HTMLDivElement>(null);
  const focusBeforeSearch = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    persistTheme(theme);
  }, [theme]);

  useLayoutEffect(() => {
    if (viewAreaRef.current) viewAreaRef.current.scrollTop = 0;
  }, [view, projectId]);

  useEffect(() => {
    if (view !== 'workflows' || queueNavigationToken === 0) return;
    document.querySelector('[aria-label="Automatische Warteschlange"]')?.scrollIntoView({ block: 'center' });
    setQueueNavigationToken(0);
  }, [view, queueNavigationToken]);

  const loadProjects = useCallback(async () => {
    if (!window.studio) throw new Error('Die Desktop-Verbindung ist nicht verfügbar. Bitte Branchloom als App starten.');
    const [items, organization] = await Promise.all([window.studio.projects(), window.studio.projectOrganization()]);
    setProjects(items);
    setProjectOrganization(organization);
    setProjectId((previous) => previous && items.some((item) => item.id === previous) ? previous : items[0]?.id ?? null);
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId || !window.studio) return;
    setSnapshot(await window.studio.snapshot(projectId));
  }, [projectId]);

  const checkProjectRadar = useCallback(async () => {
    if (!projectId || radarInFlight.current) return;
    const generation = radarGeneration.current;
    radarInFlight.current = true;
    setProjectRadarBusy(true);
    try {
      const result = await window.studio.reviewProjectConflicts(projectId);
      if (generation === radarGeneration.current) setProjectRadar(result);
    } catch (reason) {
      if (generation === radarGeneration.current) setProjectRadar({ projectId, checkedAt: new Date().toISOString(), state: 'unknown', runningCount: null,
        pairCount: 0, pairs: [], issues: [], reason: messageOf(reason) });
    } finally {
      if (generation === radarGeneration.current) { radarInFlight.current = false; setProjectRadarBusy(false); }
    }
  }, [projectId]);

  useEffect(() => {
    radarGeneration.current += 1;
    radarInFlight.current = false;
    setProjectRadar(null);
    setProjectRadarBusy(false);
    if (!projectId) return;
    const stop = startConflictRadarRefresh(true, () => { void checkProjectRadar(); });
    return () => { radarGeneration.current += 1; radarInFlight.current = false; stop(); };
  }, [projectId, checkProjectRadar]);

  const runningSessionKey = snapshot?.project.id === projectId
    ? snapshot.sessions.filter((session) => session.state === 'running').map((session) => session.id).sort().join(':') : '';
  useEffect(() => {
    if (snapshot?.project.id === projectId) void checkProjectRadar();
  }, [projectId, runningSessionKey, checkProjectRadar]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadProjects().catch((reason: unknown) => {
      if (active) setError(messageOf(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadProjects]);

  useEffect(() => {
    setSnapshot(null);
    setSearchOpen(false);
    setNavigationTarget(null);
    setOpenPlan(null);
    if (!projectId) return;
    let active = true;
    window.studio.snapshot(projectId).then((data) => {
      if (active) setSnapshot(data);
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        if (snapshot?.project.id === projectId && !creatingProject) openSearch();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [snapshot, projectId, creatingProject]);

  useEffect(() => window.studio.onBrowserSearchShortcut(() => {
    if (snapshot?.project.id === projectId && !creatingProject) {
      focusBeforeSearch.current = searchButtonRef.current;
      setSearchOpen(true);
    }
  }), [snapshot?.project.id, projectId, creatingProject]);

  function openSearch() {
    if (!searchOpen) focusBeforeSearch.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    const previous = focusBeforeSearch.current;
    requestAnimationFrame(() => (previous?.isConnected ? previous : searchButtonRef.current)?.focus());
  }

  function navigateToEntity(kind: SearchKind, id: string) {
    setNavigationTarget((old) => ({ kind, id, token: (old?.token ?? 0) + 1 }));
    setView(viewForSearchKind(kind));
  }

  function navigateToDiffComment(cardId: string, commentId: string) {
    setNavigationTarget((old) => ({ kind: 'card', id: cardId, token: (old?.token ?? 0) + 1, reviewCommentId: commentId }));
    setView('board');
  }

  function navigateToQaReport(cardId: string, reportId: string) {
    setNavigationTarget((old) => ({ kind: 'card', id: cardId, token: (old?.token ?? 0) + 1, qaReportId: reportId }));
    setView('board');
  }

  function navigateToResult(result: ProjectSearchResult) {
    navigateToEntity(result.kind, result.id);
    closeSearch();
  }

  function navigateToQueue() {
    setNavigationTarget(null);
    setView('workflows');
    setQueueNavigationToken((value) => value + 1);
  }

  function openGlobalItem(item: GlobalInboxItem) {
    if (!projects.some((project) => project.id === item.projectId)) {
      setError('Das Projekt dieses Inbox-Eintrags ist nicht mehr vorhanden.');
      return;
    }
    setPendingGlobalItem(item);
    if (projectId !== item.projectId) setProjectId(item.projectId);
  }

  useEffect(() => {
    if (!pendingGlobalItem || snapshot?.project.id !== pendingGlobalItem.projectId || projectId !== pendingGlobalItem.projectId) return;
    const item = pendingGlobalItem;
    setPendingGlobalItem(null);
    if (item.kind === 'queue') navigateToQueue();
    else if (item.kind === 'workflow') navigateToEntity('workflow', item.sourceId);
    else if (item.kind === 'session') void openSessionFromMemory(item.sourceId);
    else if (item.kind === 'plan') { setOpenPlan((old) => ({ id: item.sourceId, token: (old?.token ?? 0) + 1 })); setView('workflows'); }
    else if (item.kind === 'diff') navigateToDiffComment(item.sourceId, item.id.slice(5));
    else if (item.kind === 'guest') navigateToEntity('card', item.sourceId);
    else navigateToQaReport(item.sourceId, item.id.slice(3));
  }, [pendingGlobalItem, projectId, snapshot?.project.id]);

  async function saveSessionAsNote(session: Session) {
    if (!snapshot || session.projectId !== snapshot.project.id || session.state === 'running') return;
    const existing = snapshot.notes.find((note) => note.tags.includes('agentenlauf') && note.body.includes(`Sitzung: ${session.id}\n`));
    if (existing) { navigateToEntity('note', existing.id); return; }
    const cardTitle = snapshot.cards.find((card) => card.id === session.cardId)?.title ?? 'Entfernte Karte';
    const agentName = snapshot.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Entfernter Agent';
    const saved = await mutate(() => window.studio.saveNote({ projectId: snapshot.project.id, ...sessionMemoryDraft(session, cardTitle, agentName) }));
    if (saved) navigateToEntity('note', saved.id);
  }

  async function openSessionFromMemory(sessionId: string) {
    if (!snapshot) return;
    try {
      setError('');
      const found = await window.studio.sessionForProject({ projectId: snapshot.project.id, sessionId });
      setSnapshot((old) => old && old.project.id === found.projectId && !old.sessions.some((item) => item.id === found.id)
        ? { ...old, sessions: [found, ...old.sessions] } : old);
      navigateToEntity('session', sessionId);
    } catch {
      setError('Der Quellverlauf ist in diesem Projekt nicht mehr vorhanden.');
    }
  }

  async function acknowledgeInterruptedSession(sessionId: string) {
    if (!snapshot || !window.confirm('Hast du den gespeicherten Verlauf und die betroffenen Projektdateien geprüft? Das Quittieren startet keinen Agenten und löst einen pausierten Workflow nicht auf.')) return;
    await mutate(() => window.studio.acknowledgeInterruptedSession({ projectId: snapshot.project.id, sessionId }));
  }

  useEffect(() => {
    if (!projectId || !window.studio) return;
    const unsubscribe = window.studio.onSessionEvent((event) => {
      if (event.type === 'output') {
        setSnapshot((old) => old ? {
          ...old,
          sessions: old.sessions.map((session) => session.id === event.sessionId
            ? { ...session, output: (session.output + event.data).slice(-100_000) } : session),
        } : old);
      } else {
        void refresh().catch((reason: unknown) => setError(messageOf(reason)));
      }
    });
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 15_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [projectId, refresh]);

  async function mutate<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      setError('');
      const result = await action();
      await refresh();
      return result;
    } catch (reason) {
      // A rejected action may still have persisted a paused workflow or a
      // partial diagnostic state. Show that state without hiding the error.
      try { await refresh(); } catch { /* Keep the original action error. */ }
      setError(messageOf(reason));
      return null;
    }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await mutate(() => window.studio.createProject(newProject));
    if (!created) return;
    await loadProjects();
    setProjectId(created.id);
    setCreatingProject(false);
    setNewProject({ name: '', path: '' });
  }

  async function exportProjectPackage() {
    if (!projectId) return;
    try {
      setError('');
      const result = await window.studio.exportProjectPackage(projectId);
      if (result) setNotice(`Projektpaket gespeichert: ${result.file}`);
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function previewProjectPackage() {
    try {
      setError('');
      const preview = await window.studio.previewProjectPackage();
      if (!preview) return;
      setImportPreview(preview);
      setImportTarget({ name: `${preview.name} (Import)`, path: '' });
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function importProjectPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importPreview) return;
    const created = await mutate(() => window.studio.importProjectPackage({ fingerprint: importPreview.fingerprint, ...importTarget }));
    if (!created) return;
    await loadProjects();
    setProjectId(created.id);
    setImportPreview(null);
    setNotice(`Projekt „${created.name}“ wurde importiert. Agenten und Warteschlange bleiben ausgeschaltet.`);
  }

  const activeView = views.find((item) => item.id === view)!;
  const decisionStatus = decisionNavigationStatus(snapshot, projectId, reviewIndicator);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><BranchloomMark /></span><strong>Branchloom</strong></div>
      {projects.length ? <div className="sidebar-projects">
        <span className="side-section-title">Projekt</span>
        <ProjectSwitcher projects={projects} projectId={projectId} organization={projectOrganization} onSelect={(id) => { setPendingGlobalItem(null); setProjectId(id); }} onOrganizationChange={setProjectOrganization} onError={setError} />
        <details className="project-actions" ref={projectMenuRef}><summary><MoreHorizontal size={17} aria-hidden="true" /> Projektaktionen</summary><div className="project-actions-menu">
          <button type="button" onClick={() => { if (projectMenuRef.current) projectMenuRef.current.open = false; setCreatingProject(true); }}><Plus size={15} aria-hidden="true" /> Codeordner hinzufügen</button>
          <button type="button" onClick={() => { if (projectMenuRef.current) projectMenuRef.current.open = false; void previewProjectPackage(); }}><Upload size={15} aria-hidden="true" /> Branchloom-Paket (.json) importieren</button>
          <button type="button" disabled={!projectId} onClick={() => { if (projectMenuRef.current) projectMenuRef.current.open = false; void exportProjectPackage(); }}><Download size={15} aria-hidden="true" /> Projekt sichern</button>
        </div></details>
      </div> : null}
      {/* The source Electron smoke still drives this non-interactive selector while its UI scripts migrate. */}
      <select id="project-select" hidden aria-hidden="true" tabIndex={-1} value={projectId ?? ''} onChange={(event) => { setPendingGlobalItem(null); setProjectId(event.target.value || null); }}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      {projectId ? <WorkspaceNavigation activeView={view} decisionCount={decisionStatus?.count ?? null} decisionHasMore={decisionStatus?.hasMore} onView={setView} status={projectNavigationStatus(snapshot, projectId)} /> : null}
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-title"><h1>{projectId ? activeView.name : 'Start'}</h1></div>
        <div className="topbar-actions">
          {projectId ? <><div className={searchOpen ? 'topbar-search-slot is-open' : 'topbar-search-slot'}><button ref={searchButtonRef} className="search-trigger" type="button" title="Projekt durchsuchen (Strg+K)" aria-label="Projekt durchsuchen" aria-expanded={searchOpen} disabled={!snapshot || snapshot.project.id !== projectId} onClick={openSearch}><Search size={16} /><span>Projekt durchsuchen…</span><kbd>Strg K</kbd></button>{searchOpen && snapshot?.project.id === projectId ? <SearchPalette snapshot={snapshot} onClose={closeSearch} onNavigate={navigateToResult} /> : null}</div><button className="project-pause-button" type="button" aria-label={snapshot?.runPause.state === 'paused' ? 'Projekt fortsetzen' : snapshot?.runPause.state === 'requested' ? 'Anhalten angefordert' : 'Sicher anhalten'} disabled={!snapshot || snapshot.project.id !== projectId || snapshot.runPause.state === 'requested'} onClick={() => snapshot && void mutate(() => window.studio.setProjectRunPause({ projectId: snapshot.project.id, paused: snapshot.runPause.state === 'active' }))}>{snapshot?.runPause.state === 'paused' ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}<span>{snapshot?.runPause.state === 'paused' ? 'Projekt fortsetzen' : snapshot?.runPause.state === 'requested' ? 'Anhalten angefordert' : 'Sicher anhalten'}</span></button><button className="icon-button" type="button" title="Projektgespräch als Seitenleiste" aria-label="Projektgespräch als Seitenleiste" aria-expanded={view === 'chat' || chatDockOpen} disabled={!snapshot || snapshot.project.id !== projectId} onClick={() => { if (view === 'chat') { setView('board'); setChatDockOpen(true); } else setChatDockOpen((open) => !open); }}><MessageCircle size={17} aria-hidden="true" /></button></> : null}
          <button className="icon-button theme-toggle" type="button" title={themeToggleLabel(theme)} aria-label={themeToggleLabel(theme)} onClick={() => setTheme((previous) => previous === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}</button>
          {projectId ? <button className="icon-button" type="button" title="Aktualisieren" aria-label="Aktualisieren" onClick={() => void refresh()}><RefreshCw size={17} /></button> : null}
        </div>
      </header>
      {projectId ? <div className="mobile-workspace">
        <ProjectSwitcher compact projects={projects} projectId={projectId} organization={projectOrganization} onSelect={(id) => { setPendingGlobalItem(null); setProjectId(id); }} onOrganizationChange={setProjectOrganization} onError={setError} />
        <button className="icon-button" type="button" onClick={() => setCreatingProject(true)} aria-label="Codeordner hinzufügen" title="Codeordner hinzufügen"><Plus size={18} /></button>
        <button className="icon-button" type="button" onClick={() => void previewProjectPackage()} aria-label="Branchloom-Paket (.json) importieren" title="Branchloom-Paket (.json) importieren"><Upload size={18} /></button>
        <button className="icon-button" type="button" disabled={!projectId} onClick={() => void exportProjectPackage()} aria-label="Projekt sichern" title="Projekt sichern"><Download size={18} /></button>
      </div> : null}

      {snapshot?.project.id === projectId && snapshot.runPause.state !== 'active' ? <div className="project-pause-status" role="status">
        <strong>{snapshot.runPause.state === 'requested' ? 'Anhalten angefordert' : 'Projekt angehalten'}</strong>
        {snapshot.runPause.state === 'requested' ? <details><summary>{snapshot.runPause.running.length} laufende {snapshot.runPause.running.length === 1 ? 'Arbeit' : 'Arbeiten'} beenden sich noch</summary><ul>{snapshot.runPause.running.map((item) => <li key={`${item.kind}:${item.id}`}><button type="button" onClick={() => navigateToEntity('card', item.cardId)}>{item.kind === 'agent' ? 'Agent' : item.kind === 'integration-test' ? 'Integrationstest' : 'Integration'} · {item.title}</button></li>)}</ul></details> : <span>Queue und Workflows bleiben pausiert. Fortsetzen startet keinen Lauf automatisch.</span>}
      </div> : null}

      {projectRadar?.projectId === projectId ? <ProjectConflictBanner result={projectRadar} busy={projectRadarBusy}
        onRefresh={() => void checkProjectRadar()} onOpenCard={(id) => navigateToEntity('card', id)} /> : null}
      {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fehler schließen">×</button></div> : null}
      {notice ? <div className="package-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Hinweis schließen">×</button></div> : null}
      {loading ? <div className="content-message">Projekte werden geladen…</div> : view === 'browser' ? <div className="view-area" ref={viewAreaRef}><Suspense fallback={<div className="content-message" role="status">Browser wird geladen…</div>}><BrowserView active={!creatingProject && !searchOpen} snapshot={snapshot?.project.id === projectId ? snapshot : null} onOpenCard={async (id) => { await refresh(); navigateToEntity('card', id); }} onOpenSettings={snapshot?.project.id === projectId ? () => setView('settings') : undefined} /></Suspense></div> : !projectId ? <div className="empty-intro"><h2>Dein Projekt beginnt mit einem Ordner.</h2><p>Branchloom hilft dir, Ideen als Aufgaben zu planen, einen Coding-Agenten arbeiten zu lassen und seine Änderungen vor der Übernahme zu prüfen. Wähle dafür den Ordner deiner App oder Website.</p><button className="primary-button" type="button" onClick={() => setCreatingProject(true)}><Plus size={17} /> Codeordner auswählen</button><p className="first-run-detail">Für parallele Agentenläufe kann Branchloom getrennte Git-Arbeitskopien anlegen. Dafür muss der Ordner ein Git-Repository sein.</p><button className="first-run-import" type="button" onClick={() => void previewProjectPackage()}>Vorhandenes Branchloom-Paket importieren</button></div> : !snapshot ? <div className="content-message">Workspace wird geladen…</div> : <div className="view-area" ref={viewAreaRef}>
        <Suspense fallback={<div className="content-message" role="status">{activeView.name} wird geladen…</div>}>
        {view === 'board' ? <BoardView snapshot={snapshot} mutate={mutate} openCard={navigationTarget?.kind === 'card' ? navigationTarget : null} onOpenDesign={(cardId) => { setDesignCardId(cardId); setView('design'); }} onOpenBrowser={() => setView('browser')} onOpenQaReport={navigateToQaReport} /> : null}
        {view === 'ideas' ? <IdeasView key={snapshot.project.id} snapshot={snapshot} mutate={mutate} onOpenCard={(id) => navigateToEntity('card', id)} /> : null}
        {view === 'activity' ? <ActivityView snapshot={snapshot} openSession={navigationTarget?.kind === 'session' ? navigationTarget : null} onSessionClosed={() => setNavigationTarget((old) => old?.kind === 'session' ? null : old)} onOpenCard={(id) => navigateToEntity('card', id)} onOpenWorkflow={(id) => navigateToEntity('workflow', id)} onSaveSessionAsNote={saveSessionAsNote} /> : null}
        {view === 'changelog' ? <ChangelogView key={snapshot.project.id} projectId={snapshot.project.id}
          onOpenCard={(id) => navigateToEntity('card', id)} onOpenQaReport={navigateToQaReport} /> : null}
        {view === 'workflows' ? <WorkflowView snapshot={snapshot} mutate={mutate} openWorkflow={navigationTarget?.kind === 'workflow' ? navigationTarget : null} openPlan={openPlan} onOpenCard={(id) => navigateToEntity('card', id)} onOpenSession={(id) => void openSessionFromMemory(id)} /> : null}
        {view === 'decisions' ? <DecisionInbox snapshot={snapshot} onOpenWorkflow={(id) => navigateToEntity('workflow', id)} onOpenQueue={navigateToQueue} onOpenSession={(id) => void openSessionFromMemory(id)} onOpenCard={(id) => navigateToEntity('card', id)} onOpenDiffComment={navigateToDiffComment} onOpenQaReport={navigateToQaReport} onOpenPlan={(id) => { setOpenPlan((old) => ({ id, token: (old?.token ?? 0) + 1 })); setView('workflows'); }} onAcknowledgeSession={(id) => void acknowledgeInterruptedSession(id)} onOpenGlobalItem={openGlobalItem} /> : null}
        {view === 'whiteboard' ? <WhiteboardView snapshot={snapshot} mutate={mutate} openNodeId={whiteboardOpenNodeId} onOpenCard={(id) => navigateToEntity('card', id)} /> : null}
        {view === 'memory' ? <MemoryView snapshot={snapshot} mutate={mutate} openNote={navigationTarget?.kind === 'note' ? navigationTarget : null} onOpenSession={(id) => void openSessionFromMemory(id)} onOpenCard={(id) => navigateToEntity('card', id)} /> : null}
        {view === 'milestones' ? <MilestonesView key={snapshot.project.id} projectId={snapshot.project.id} /> : null}
        {view === 'agents' ? <AgentView snapshot={snapshot} mutate={mutate} onOpenBrowserSettings={() => setView('settings')} /> : null}
        {view === 'settings' ? <ProjectSettingsView project={snapshot.project} /> : null}
        {view === 'terminal' ? <CommandTerminalView key={snapshot.project.id} projectId={snapshot.project.id} columns={snapshot.columns} onOpenCard={async (card) => { await refresh(); navigateToEntity('card', card.id); }} /> : null}
        {view === 'design' ? <DesignInspectionView key={snapshot.project.id} projectId={snapshot.project.id} active={!creatingProject && !searchOpen} cards={snapshot.cards} startCardId={designCardId} columns={snapshot.columns} queueState={snapshot.queue.state} onOpenCard={async (id) => { await refresh(); navigateToEntity('card', id); }} onCreated={refresh} /> : null}
        </Suspense>
      </div>}
      {snapshot?.project.id === projectId ? <div className={`project-chat-host ${view === 'chat' ? 'page' : 'dock'}`} hidden={view !== 'chat' && !chatDockOpen}>
        {view !== 'chat' && chatDockOpen ? <button type="button" className="project-chat-close icon-button" aria-label="Projektgespräch schließen" title="Projektgespräch schließen" onClick={() => setChatDockOpen(false)}><X size={17} aria-hidden="true" /></button> : null}
        <Suspense fallback={<div className="content-message" role="status">Projektgespräch wird geladen…</div>}><ProjectChat key={snapshot.project.id} snapshot={snapshot} onOpenCard={(id) => { setChatDockOpen(false); navigateToEntity('card', id); }} onOpenSession={(id) => { setChatDockOpen(false); void openSessionFromMemory(id); }} onSaveTask={async (title, description) => {
          const column = snapshot.columns.find((item) => item.name.trim().toLocaleLowerCase() === 'to do') ?? snapshot.columns[0];
          if (!column) throw new Error('Dieses Projekt hat keine Boardspalte.');
          const card = await window.studio.createCard({ projectId: snapshot.project.id, columnId: column.id, title, description });
          await refresh();
          setChatDockOpen(false);
          navigateToEntity('card', card.id);
        }} onSaveCanvas={async (title, description) => {
          const sourceProjectId = snapshot.project.id;
          const node = await savePreparedChatCanvasNode(window.studio, sourceProjectId, title, description,
            () => activeProjectId.current === sourceProjectId);
          if (activeProjectId.current !== sourceProjectId) return;
          setWhiteboardOpenNodeId(node.id);
          setChatDockOpen(false);
          setView('whiteboard');
        }} /></Suspense>
      </div> : null}
    </main>

    {creatingProject ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatingProject(false); }}><form className="dialog" onSubmit={(event) => void createProject(event)}><div className="dialog-heading"><div><small>Projekt</small><h2>Codeordner hinzufügen</h2></div><button type="button" className="icon-button" onClick={() => setCreatingProject(false)} aria-label="Schließen">×</button></div><p className="field-help">Wähle einen vorhandenen Ordner mit deiner App oder Website. Branchloom kopiert und verändert beim Hinzufügen keine Dateien.</p><label>Projektname<input autoFocus required maxLength={80} value={newProject.name} onChange={(event) => setNewProject((old) => ({ ...old, name: event.target.value }))} placeholder="Mein Projekt" /></label><ProjectFolderField id="new-project-folder" value={newProject.path} onChange={(path) => setNewProject((old) => ({ ...old, path }))} onSelected={(path) => setNewProject((old) => ({ path, name: old.name || path.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 80) || '' }))} onError={setError} /><p className="field-help">Agenten dürfen später in diesem Ordner Dateien ändern, aber erst wenn du einen Lauf ausdrücklich startest. Für getrennte Git-Arbeitskopien muss der Ordner ein Git-Repository sein.</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreatingProject(false)}>Abbrechen</button><button type="submit" className="primary-button">Projekt verbinden</button></div></form></div> : null}
    {importPreview ? <ProjectPackageDialog preview={importPreview} target={importTarget} onTarget={setImportTarget} onClose={() => setImportPreview(null)} onImport={(event) => void importProjectPackage(event)} onError={setError} /> : null}
  </div>;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
