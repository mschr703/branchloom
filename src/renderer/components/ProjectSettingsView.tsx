import { useState, type KeyboardEvent } from 'react';
import type { Project } from '../../shared/types';
import { languageText, type LanguagePreference } from '../language';
import type { ThemePreference } from '../theme';
import { AgentBrowserSettings } from './AgentBrowserSettings';
import { ProjectAgentRights } from './ProjectAgentRights';
import { TeamBoardShare } from './TeamBoardShare';
import { ThemeSettings } from './ThemeSettings';
import './app-language-settings.css';

export type SettingsSection = 'app' | 'project' | 'agents' | 'browser' | 'team' | 'updates';

const sectionLabels: Record<SettingsSection, Record<LanguagePreference, string>> = {
  app: { de: 'App', en: 'App' }, project: { de: 'Projekt', en: 'Project' },
  agents: { de: 'Agenten', en: 'Agents' }, browser: { de: 'Browser', en: 'Browser' },
  team: { de: 'Team', en: 'Team' }, updates: { de: 'Updates', en: 'Updates' },
};

export function ProjectSettingsView({ project, language = 'de', onLanguageChange, onOpenAgents, initialSection = 'app', theme = 'light', onThemeChange }: {
  project?: Project | null;
  language?: LanguagePreference;
  onLanguageChange?: (language: LanguagePreference) => void;
  onOpenAgents?: () => void;
  initialSection?: SettingsSection;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
}) {
  const [selected, setSelected] = useState<SettingsSection>(initialSection);
  const sections: SettingsSection[] = project ? ['app', 'project', 'agents', 'browser', 'team', 'updates'] : ['app', 'updates'];
  const active = sections.includes(selected) ? selected : 'app';

  function moveSection(event: KeyboardEvent<HTMLElement>) {
    const currentIndex = sections.indexOf(active);
    const nextIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (currentIndex + 1) % sections.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (currentIndex - 1 + sections.length) % sections.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    setSelected(sections[nextIndex]!);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  return <div className="standard-page app-settings-page">
    <div className="view-header"><div><h2>{project ? (language === 'en' ? 'App & project' : 'App & Projekt') : (language === 'en' ? 'App' : 'App')}</h2><p>{project ? (language === 'en' ? `Device preferences and permissions for ${project.name}.` : `Geräteeinstellungen und Freigaben für ${project.name}.`) : (language === 'en' ? 'Choose how this app works on your device.' : 'Lege fest, wie Branchloom auf diesem Gerät arbeitet.')}</p></div></div>
    <div className="app-settings-layout">
      <div className="app-settings-navigation" role="tablist" aria-label={language === 'en' ? 'Settings sections' : 'Einstellungsbereiche'} onKeyDown={moveSection}>
        {sections.map((section) => <button key={section} id={`settings-tab-${section}`} role="tab" type="button" aria-selected={active === section} aria-controls={`settings-panel-${section}`} tabIndex={active === section ? 0 : -1} onClick={() => setSelected(section)}>{sectionLabels[section][language]}</button>)}
      </div>
      <div className="app-settings-content">
        <section id="settings-panel-app" className="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-app" hidden={active !== 'app'}>
          <div className="app-settings-panel-heading"><h3>{language === 'en' ? 'Appearance & language' : 'Darstellung & Sprache'}</h3><p>{language === 'en' ? 'Preferences for this Branchloom installation.' : 'Diese Einstellungen gelten für deine Branchloom-Installation.'}</p></div>
          {onThemeChange ? <ThemeSettings theme={theme} language={language} onChange={onThemeChange} /> : null}
          <div className="app-language-settings"><div><h4 id="app-language-heading">{languageText(language, 'language')}</h4><p>{languageText(language, 'languageHint')}</p></div>
            <fieldset aria-labelledby="app-language-heading"><legend className="sr-only">{languageText(language, 'language')}</legend>
              <label><input type="radio" name="app-language" value="de" checked={language === 'de'} onChange={() => onLanguageChange?.('de')} />Deutsch</label>
              <label><input type="radio" name="app-language" value="en" checked={language === 'en'} onChange={() => onLanguageChange?.('en')} />English</label>
            </fieldset>
          </div>
        </section>
        {project ? <>
          <section id="settings-panel-project" className="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-project" hidden={active !== 'project'}>
            <div className="app-settings-panel-heading"><h3>{languageText(language, 'projectPermissionsTitle')}</h3><p>{language === 'en' ? 'Controls for new agent runs in this project.' : 'Freigaben für neue Agentenläufe in diesem Projekt.'}</p></div>
            <ProjectAgentRights key={`rights-${project.id}`} projectId={project.id} />
          </section>
          <section id="settings-panel-agents" className="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-agents" hidden={active !== 'agents'}>
            <div className="app-settings-panel-heading"><h3>{sectionLabels.agents[language]}</h3><p>{language === 'en' ? 'Agent profiles, local CLI checks, and model access are managed in the Agents view.' : 'Agentenprofile, lokale CLI-Prüfung und Modellzugang verwaltest du in der Agentenansicht.'}</p></div>
            <button type="button" className="secondary-button" onClick={onOpenAgents} disabled={!onOpenAgents}>{language === 'en' ? 'Open Agents' : 'Agenten öffnen'}</button>
          </section>
          <section id="settings-panel-browser" className="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-browser" hidden={active !== 'browser'}>
            <div className="app-settings-panel-heading"><h3>{language === 'en' ? 'Agent browser access' : 'Browserzugriff für Agenten'}</h3><p>{language === 'en' ? 'Read-only checks are limited to one approved local development address.' : 'Lesende Prüfungen sind auf eine freigegebene lokale Entwicklungsadresse begrenzt.'}</p></div>
            <AgentBrowserSettings key={project.id} projectId={project.id} />
          </section>
          <section id="settings-panel-team" className="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-team" hidden={active !== 'team'}>
            <div className="app-settings-panel-heading"><h3>{language === 'en' ? 'Project sharing' : 'Projekt teilen'}</h3><p>{language === 'en' ? 'Create and revoke guest links for this project.' : 'Gastlinks für dieses Projekt erstellen und widerrufen.'}</p></div>
            <TeamBoardShare key={`team-board-${project.id}`} projectId={project.id} />
          </section>
        </> : null}
        <section id="settings-panel-updates" className="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-updates" hidden={active !== 'updates'}>
          <div className="app-settings-panel-heading"><h3>{sectionLabels.updates[language]}</h3><p>{language === 'en' ? 'The installed Windows app checks published GitHub releases. You choose when to install an available update.' : 'Die installierte Windows-App prüft veröffentlichte GitHub-Releases. Ein verfügbares Update wird erst nach deiner Auswahl installiert.'}</p></div>
          <p className="app-settings-update-note">{language === 'en' ? 'Portable builds and source checkouts do not update automatically.' : 'Portable Pakete und Quellcode-Starts aktualisieren sich nicht automatisch.'}</p>
        </section>
      </div>
    </div>
  </div>;
}
