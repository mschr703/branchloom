import { Activity, Bot, BrainCircuit, Columns3, GitBranch, GitCommitHorizontal, Globe2, History, Inbox, Lightbulb, MessageCircle, MousePointer2, Network, Settings2, TerminalSquare } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';

export type View = 'board' | 'ideas' | 'chat' | 'activity' | 'workflows' | 'decisions' | 'whiteboard' | 'memory' | 'milestones' | 'agents' | 'terminal' | 'browser' | 'design' | 'changelog' | 'settings';

export const views: { id: View; name: string; icon: typeof Columns3 }[] = [
  { id: 'board', name: 'Board', icon: Columns3 },
  { id: 'ideas', name: 'Ideenraum', icon: Lightbulb },
  { id: 'chat', name: 'Projektgespräch', icon: MessageCircle },
  { id: 'activity', name: 'Aktivität', icon: Activity },
  { id: 'changelog', name: 'Changelog', icon: GitCommitHorizontal },
  { id: 'workflows', name: 'Workflows', icon: GitBranch },
  { id: 'decisions', name: 'Entscheidungen', icon: Inbox },
  { id: 'whiteboard', name: 'Whiteboard', icon: Network },
  { id: 'memory', name: 'Memory', icon: BrainCircuit },
  { id: 'milestones', name: 'Zeitmaschine', icon: History },
  { id: 'agents', name: 'Agenten', icon: Bot },
  { id: 'terminal', name: 'Terminal', icon: TerminalSquare },
  { id: 'browser', name: 'Webvorschau', icon: Globe2 },
  { id: 'design', name: 'Design', icon: MousePointer2 },
  { id: 'settings', name: 'Einstellungen', icon: Settings2 },
];

const primaryViewIds: View[] = ['board', 'ideas', 'chat', 'workflows'];
const primaryViews = primaryViewIds.map((id) => views.find((item) => item.id === id)!);
const secondaryGroups: { name: string; ids: View[] }[] = [
  { name: 'Entwurf & Wissen', ids: ['whiteboard', 'memory', 'design', 'milestones'] },
  { name: 'Prüfung', ids: ['decisions', 'activity', 'changelog'] },
  { name: 'Werkzeuge', ids: ['agents', 'terminal', 'browser', 'settings'] },
];

interface Props {
  activeView: View;
  decisionCount: number | null;
  decisionHasMore?: boolean;
  onView: (view: View) => void;
  status?: ProjectNavigationStatus | null;
}

export interface ProjectNavigationStatus { activeCards: number; runningSessions: number }

export function projectNavigationStatus(snapshot: ProjectSnapshot | null, projectId: string | null): ProjectNavigationStatus | null {
  if (!snapshot || !projectId || snapshot.project.id !== projectId) return null;
  return {
    activeCards: snapshot.cards.filter((card) => !card.archivedAt).length,
    runningSessions: snapshot.sessions.filter((session) => session.state === 'running').length,
  };
}

/** Project context stays above this compact, fully labelled navigation. */
export function WorkspaceNavigation({ activeView, decisionCount, decisionHasMore = false, onView, status }: Props) {
  const item = ({ id, name, icon: Icon }: typeof views[number]) =>
    <button key={id} type="button" className={activeView === id ? 'nav-item active' : 'nav-item'}
      onClick={() => onView(id)} aria-current={activeView === id ? 'page' : undefined}
      aria-label={id === 'decisions' && decisionCount === null ? `${name}: offene Einträge werden geprüft` : id === 'decisions' && decisionCount ? `${name}: ${decisionHasMore ? 'mindestens ' : ''}${decisionCount} offen` : name} title={name}>
      <Icon size={18} aria-hidden="true" /><span className="nav-label">{name}</span>
      {id === 'decisions' && decisionCount === null ? <span className="nav-count" aria-hidden="true">…</span> : null}
      {id === 'decisions' && Boolean(decisionCount) ? <span className="nav-count" aria-hidden="true">{decisionCount}{decisionHasMore ? '+' : ''}</span> : null}
    </button>;
  return <><nav className="side-nav" aria-label="Hauptnavigation">
    <div className="nav-primary" role="group" aria-label="Planung">{primaryViews.map(item)}</div>
    <div className="nav-other" role="group" aria-label="Weitere Ansichten">{secondaryGroups.map((group) =>
      <div key={group.name} className="nav-other-group" role="group" aria-label={group.name}>
        <span className="nav-other-title" aria-hidden="true">{group.name}</span>
        <div className="nav-other-items">{group.ids.map((id) => item(views.find((view) => view.id === id)!))}</div>
      </div>)}</div>
  </nav>{status ? <div className="sidebar-status" aria-label="Projektstatus">
    <span><strong>{status.runningSessions}</strong> {status.runningSessions === 1 ? 'Agentenlauf' : 'Agentenläufe'} aktiv</span>
    <span><strong>{status.activeCards}</strong> aktive {status.activeCards === 1 ? 'Karte' : 'Karten'}</span>
  </div> : null}</>;
}
