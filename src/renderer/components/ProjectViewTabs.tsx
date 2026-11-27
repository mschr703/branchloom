import './project-view-tabs.css';
import type { LanguagePreference } from '../language';

export type PlanningView = 'board' | 'ideas' | 'workflows';

const views: { id: PlanningView; label: Record<LanguagePreference, string> }[] = [
  { id: 'board', label: { de: 'Board', en: 'Board' } },
  { id: 'ideas', label: { de: 'Ideenraum', en: 'Ideas' } },
  { id: 'workflows', label: { de: 'Workflows', en: 'Workflows' } },
];

export function ProjectViewTabs({ active, onNavigate, disabled = false, language = 'de' }: {
  active: PlanningView;
  onNavigate: (view: PlanningView) => void;
  disabled?: boolean;
  language?: LanguagePreference;
}) {
  return <div className="planning-view-tabs-row">
    <nav className="board-view-tabs project-view-tabs" aria-label={language === 'en' ? 'Project views' : 'Projektansichten'}>
      {views.map((view) => view.id === active
        ? <span className="is-active" aria-current="page" key={view.id}>{view.label[language]}</span>
        : <button type="button" key={view.id} disabled={disabled} onClick={() => onNavigate(view.id)}>{view.label[language]}</button>)}
    </nav>
  </div>;
}
