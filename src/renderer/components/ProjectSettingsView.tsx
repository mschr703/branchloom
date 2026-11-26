import type { Project } from '../../shared/types';
import { AgentBrowserSettings } from './AgentBrowserSettings';
import { ProjectAgentRights } from './ProjectAgentRights';

export function ProjectSettingsView({ project }: { project: Project }) {
  return <div className="standard-page">
    <div className="view-header"><div><h2>Einstellungen</h2><p>Freigaben für {project.name}. Änderungen gelten nur für dieses Projekt.</p></div></div>
    <ProjectAgentRights key={`rights-${project.id}`} projectId={project.id} />
    <AgentBrowserSettings key={project.id} projectId={project.id} />
  </div>;
}
