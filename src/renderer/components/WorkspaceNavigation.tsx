import { Activity, ArrowUpRight, Bot, BrainCircuit, CalendarDays, Columns3, GitBranch, GitCommitHorizontal, Globe2, History, Inbox, Lightbulb, MessageCircle, MousePointer2, Network, Settings2, TerminalSquare, UsersRound } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import type { LanguagePreference } from '../language';

export type View = 'board' | 'ideas' | 'chat' | 'activity' | 'workflows' | 'calendar' | 'team' | 'decisions' | 'whiteboard' | 'memory' | 'milestones' | 'agents' | 'terminal' | 'browser' | 'design' | 'changelog' | 'settings';

export const views: { id: View; name: string; icon: typeof Columns3 }[] = [
  { id: 'board', name: 'Board', icon: Columns3 },
  { id: 'ideas', name: 'Ideenraum', icon: Lightbulb },
  { id: 'chat', name: 'Projektgespräch', icon: MessageCircle },
  { id: 'activity', name: 'Aktivität', icon: Activity },
  { id: 'changelog', name: 'Changelog', icon: GitCommitHorizontal },
  { id: 'workflows', name: 'Workflows', icon: GitBranch },
  { id: 'calendar', name: 'Kalender', icon: CalendarDays },
  { id: 'team', name: 'Team', icon: UsersRound },
  { id: 'decisions', name: 'Entscheidungen', icon: Inbox },
  { id: 'whiteboard', name: 'Whiteboard', icon: Network },
  { id: 'memory', name: 'Memory', icon: BrainCircuit },
  { id: 'milestones', name: 'Zeitmaschine', icon: History },
  { id: 'agents', name: 'Agenten', icon: Bot },
  { id: 'terminal', name: 'Projekt-Terminal', icon: TerminalSquare },
  { id: 'browser', name: 'Webvorschau', icon: Globe2 },
  { id: 'design', name: 'Design', icon: MousePointer2 },
  { id: 'settings', name: 'Einstellungen', icon: Settings2 },
];

const englishViewNames: Record<View, string> = {
  board: 'Board', ideas: 'Ideas', chat: 'Project chat', activity: 'Activity', workflows: 'Workflows', calendar: 'Calendar',
  team: 'Team', decisions: 'Decisions', whiteboard: 'Whiteboard', memory: 'Memory',
  milestones: 'Timeline', agents: 'Agents', terminal: 'Project terminal', browser: 'Web preview',
  design: 'Design', changelog: 'Changelog', settings: 'Settings',
};

export function viewName(view: View, language: LanguagePreference): string {
  return language === 'en' ? englishViewNames[view] : views.find((item) => item.id === view)?.name ?? view;
}

const primaryViewIds: View[] = ['board', 'ideas', 'chat', 'workflows', 'calendar', 'team'];
const primaryViews = primaryViewIds.map((id) => views.find((item) => item.id === id)!);
const secondaryGroups: { name: string; ids: View[] }[] = [
  { name: 'Entwurf & Wissen', ids: ['whiteboard', 'memory', 'design', 'milestones'] },
  { name: 'Prüfung', ids: ['decisions', 'activity', 'changelog'] },
  { name: 'Werkzeuge', ids: ['agents', 'terminal', 'browser', 'settings'] },
];

interface Props {
  activeView: View;
  language?: LanguagePreference;
  decisionCount: number | null;
  decisionHasMore?: boolean;
  onView: (view: View) => void;
  onOpenCard?: (cardId: string) => void;
  status?: ProjectNavigationStatus | null;
}

export interface ProjectNavigationStatus { activeCards: number; runningSessions: number; firstRunning?: { cardId: string; cardTitle: string; agentName: string } }

export function projectNavigationStatus(snapshot: ProjectSnapshot | null, projectId: string | null): ProjectNavigationStatus | null {
  if (!snapshot || !projectId || snapshot.project.id !== projectId) return null;
  const running = snapshot.sessions.filter((session) => session.state === 'running');
  const first = running.find((session) => Boolean(session.cardId) && snapshot.cards.some((card) => Boolean(card.id) && card.id === session.cardId));
  const card = snapshot.cards.find((item) => item.id === first?.cardId);
  return {
    activeCards: snapshot.cards.filter((card) => !card.archivedAt).length,
    runningSessions: running.length,
    ...(first && card ? { firstRunning: { cardId: card.id, cardTitle: card.title, agentName: snapshot.agents?.find((agent) => agent.id === first.agentId)?.name ?? 'Agent' } } : {}),
  };
}

/** Project context stays above this compact, fully labelled navigation. */
export function WorkspaceNavigation({ activeView, language = 'de', decisionCount, decisionHasMore = false, onView, onOpenCard, status }: Props) {
  const item = ({ id, icon: Icon }: typeof views[number]) => {
    const name = viewName(id, language);
    const runningOnBoard = id === 'board' && Boolean(status?.runningSessions);
    return (
    <button key={id} type="button" className={activeView === id ? 'nav-item active' : 'nav-item'}
      onClick={() => onView(id)} aria-current={activeView === id ? 'page' : undefined}
      aria-label={id === 'decisions' && decisionCount === null ? `${name}: ${language === 'en' ? 'checking open items' : 'offene Einträge werden geprüft'}` : id === 'decisions' && decisionCount ? `${name}: ${decisionHasMore ? language === 'en' ? 'at least ' : 'mindestens ' : ''}${decisionCount} ${language === 'en' ? 'open' : 'offen'}` : runningOnBoard ? `${name}: ${status!.runningSessions} ${language === 'en' ? 'active agent runs' : 'aktive Agentenläufe'}` : name} title={name}>
      <Icon size={18} aria-hidden="true" /><span className="nav-label">{name}</span>
      {runningOnBoard ? <span className="nav-running-indicator" aria-hidden="true" /> : null}
      {id === 'decisions' && decisionCount === null ? <span className="nav-count" aria-hidden="true">…</span> : null}
      {id === 'decisions' && Boolean(decisionCount) ? <span className="nav-count" aria-hidden="true">{decisionCount}{decisionHasMore ? '+' : ''}</span> : null}
    </button>);
  };
  return <><nav className="side-nav" aria-label={language === 'en' ? 'Main navigation' : 'Hauptnavigation'}>
    <div className="nav-primary" role="group" aria-label={language === 'en' ? 'Planning' : 'Planung'}>{primaryViews.map(item)}</div>
    <div className="nav-other" role="group" aria-label={language === 'en' ? 'More views' : 'Weitere Ansichten'}>{secondaryGroups.map((group, index) =>
      <div key={group.name} className="nav-other-group" role="group" aria-label={language === 'en' ? ['Design & knowledge', 'Review', 'Tools'][index] : group.name}>
        <span className="nav-other-title" aria-hidden="true">{language === 'en' ? ['Design & knowledge', 'Review', 'Tools'][index] : group.name}</span>
        <div className="nav-other-items">{group.ids.map((id) => item(views.find((view) => view.id === id)!))}</div>
      </div>)}</div>
  </nav>{status ? <div className="sidebar-status" aria-label={language === 'en' ? 'Project status' : 'Projektstatus'}>
    <div className="sidebar-status-summary">
      <button type="button" className="sidebar-sessions-link" onClick={() => onView('activity')}
        aria-label={language === 'en' ? `Open agent sessions: ${status.runningSessions} active` : `Agentensitzungen öffnen: ${status.runningSessions} aktiv`}
        title={language === 'en' ? 'Open agent sessions' : 'Agentensitzungen öffnen'}>
        {status.runningSessions > 0 ? <span className="sidebar-status-live" aria-hidden="true" /> : null}
        <strong>{status.runningSessions}</strong> {language === 'en' ? `active ${status.runningSessions === 1 ? 'run' : 'runs'}` : `${status.runningSessions === 1 ? 'Lauf' : 'Läufe'} aktiv`}
        <ArrowUpRight size={12} aria-hidden="true" />
      </button>
      <span className="sidebar-status-separator" aria-hidden="true">·</span>
      <span><strong>{status.activeCards}</strong> {language === 'en' ? `${status.activeCards === 1 ? 'card' : 'cards'}` : `${status.activeCards === 1 ? 'Karte' : 'Karten'}`}</span>
    </div>
    {status.firstRunning && onOpenCard ? <button type="button" className="sidebar-running-card" onClick={() => onOpenCard(status.firstRunning!.cardId)} title={`${status.firstRunning.agentName}: ${status.firstRunning.cardTitle}`}><span className="sidebar-running-agent">{status.firstRunning.agentName}</span><span aria-hidden="true">→</span><span className="sidebar-running-title">{status.firstRunning.cardTitle}</span></button> : null}
  </div> : null}</>;
}
