import type { Project } from '../../shared/types';
import { languageText, type LanguagePreference } from '../language';
import { AgentBrowserSettings } from './AgentBrowserSettings';
import { ProjectAgentRights } from './ProjectAgentRights';
import { TeamBoardShare } from './TeamBoardShare';
import './app-language-settings.css';

export function ProjectSettingsView({ project, language = 'de', onLanguageChange }: { project?: Project | null; language?: LanguagePreference; onLanguageChange?: (language: LanguagePreference) => void }) {
  return <div className="standard-page">
    <div className="view-header"><div><h2>{languageText(language, 'settings')}</h2>{project ? <p>{languageText(language, 'projectPermissions').replace('{project}', project.name)}</p> : null}</div></div>
    <section className="app-language-settings" aria-labelledby="app-language-heading">
      <div><h3 id="app-language-heading">{languageText(language, 'language')}</h3><p>{languageText(language, 'languageHint')}</p></div>
      <fieldset aria-label={languageText(language, 'language')}>
        <legend className="sr-only">{languageText(language, 'language')}</legend>
        <label><input type="radio" name="app-language" value="de" checked={language === 'de'} onChange={() => onLanguageChange?.('de')} />Deutsch</label>
        <label><input type="radio" name="app-language" value="en" checked={language === 'en'} onChange={() => onLanguageChange?.('en')} />English</label>
      </fieldset>
    </section>
    {project ? <><h3 className="app-settings-section-title">{languageText(language, 'projectPermissionsTitle')}</h3>
      <ProjectAgentRights key={`rights-${project.id}`} projectId={project.id} />
      <AgentBrowserSettings key={project.id} projectId={project.id} />
      <TeamBoardShare key={`team-board-${project.id}`} projectId={project.id} /></> : null}
  </div>;
}
