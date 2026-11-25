import type { Project } from '../../shared/types';
import { AgentBrowserSettings } from './AgentBrowserSettings';

export function ProjectSettingsView({ project }: { project: Project }) {
  return <div className="standard-page">
    <div className="view-header"><div><h2>Einstellungen</h2><p>Freigaben für {project.name}. Änderungen gelten nur für dieses Projekt.</p></div></div>
    <AgentBrowserSettings key={project.id} projectId={project.id} />
  </div>;
}
