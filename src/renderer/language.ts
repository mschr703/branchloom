export type LanguagePreference = 'de' | 'en';

export const LANGUAGE_STORAGE_KEY = 'branchloom:language';

type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readLanguagePreference(storage: Pick<LanguageStorage, 'getItem'> | null): LanguagePreference {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

export function writeLanguagePreference(storage: Pick<LanguageStorage, 'setItem'> | null, language: LanguagePreference): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Keep the choice for this session when browser storage is unavailable.
  }
}

export function currentLanguage(): LanguagePreference {
  if (typeof window === 'undefined') return 'de';
  try { return readLanguagePreference(window.localStorage); } catch { return 'de'; }
}

export function persistLanguage(language: LanguagePreference): void {
  try { writeLanguagePreference(window.localStorage, language); } catch { /* Browser storage may be blocked. */ }
}

const copy = {
  de: {
    projects: 'Projekte', project: 'Projekt', projectActions: 'Projektaktionen', addFolder: 'Codeordner hinzufügen',
    importPackage: 'Branchloom-Paket (.json) importieren', exportProject: 'Projekt sichern', openTeam: 'Team öffnen',
    searchProject: 'Projekt durchsuchen', searchPlaceholder: 'Projekt durchsuchen…', projectConversation: 'Projektgespräch als Seitenleiste',
    refresh: 'Aktualisieren', settings: 'Einstellungen', start: 'Start',
    pauseProject: 'Sicher anhalten', resumeProject: 'Projekt fortsetzen', pauseRequested: 'Anhalten angefordert',
    lightMode: 'Helles Design aktivieren', darkMode: 'Dunkles Design aktivieren',
    loadingProjects: 'Projekte werden geladen…', loadingWorkspace: 'Workspace wird geladen…',
    firstRunTitle: 'Dein Projekt beginnt mit einem Ordner.',
    firstRunText: 'Branchloom hilft dir, Ideen als Aufgaben zu planen, einen Coding-Agenten arbeiten zu lassen und seine Änderungen vor der Übernahme zu prüfen. Wähle dafür den Ordner deiner App oder Website.',
    firstRunDetail: 'Für parallele Agentenläufe kann Branchloom getrennte Git-Arbeitskopien anlegen. Dafür muss der Ordner ein Git-Repository sein.',
    firstRunImport: 'Vorhandenes Branchloom-Paket importieren',
    folderHelp: 'Wähle einen vorhandenen Ordner mit deiner App oder Website. Branchloom kopiert und verändert beim Hinzufügen keine Dateien.',
    projectName: 'Projektname', projectNamePlaceholder: 'Mein Projekt',
    agentFolderHelp: 'Agenten dürfen später in diesem Ordner Dateien ändern, aber erst wenn du einen Lauf ausdrücklich startest. Für getrennte Git-Arbeitskopien muss der Ordner ein Git-Repository sein.',
    cancel: 'Abbrechen', connectProject: 'Projekt verbinden', close: 'Schließen',
    backToStart: 'Zurück zum Start',
    language: 'Sprache', languageHint: 'Sprache der Navigation und Einstellungen. Weitere Projektansichten werden noch übersetzt.',
    projectPermissions: 'Freigaben für {project}. Änderungen gelten nur für dieses Projekt.',
    projectPermissionsTitle: 'Projektberechtigungen',
  },
  en: {
    projects: 'Projects', project: 'Project', projectActions: 'Project actions', addFolder: 'Add code folder',
    importPackage: 'Import Branchloom package (.json)', exportProject: 'Back up project', openTeam: 'Open team',
    searchProject: 'Search project', searchPlaceholder: 'Search project…', projectConversation: 'Project chat sidebar',
    refresh: 'Refresh', settings: 'Settings', start: 'Start',
    pauseProject: 'Pause safely', resumeProject: 'Resume project', pauseRequested: 'Pause requested',
    lightMode: 'Switch to light theme', darkMode: 'Switch to dark theme',
    loadingProjects: 'Loading projects…', loadingWorkspace: 'Loading workspace…',
    firstRunTitle: 'Start with your project folder.',
    firstRunText: 'Branchloom helps you plan ideas as tasks, run a coding agent, and review its changes before integrating them. Choose the folder containing your app or website.',
    firstRunDetail: 'For parallel agent runs, Branchloom can create separate Git working copies. The folder must be a Git repository for this.',
    firstRunImport: 'Import an existing Branchloom package',
    folderHelp: 'Choose an existing folder containing your app or website. Branchloom does not copy or change files when adding it.',
    projectName: 'Project name', projectNamePlaceholder: 'My project',
    agentFolderHelp: 'Agents may change files in this folder later, but only after you explicitly start a run. Separate Git working copies require a Git repository.',
    cancel: 'Cancel', connectProject: 'Connect project', close: 'Close',
    backToStart: 'Back to start',
    language: 'Language', languageHint: 'Navigation and settings language. Other project views are still being translated.',
    projectPermissions: 'Permissions for {project}. Changes apply to this project only.',
    projectPermissionsTitle: 'Project permissions',
  },
} as const;

export type LanguageKey = keyof typeof copy.de;

export function languageText(language: LanguagePreference, key: LanguageKey): string {
  return copy[language][key];
}
