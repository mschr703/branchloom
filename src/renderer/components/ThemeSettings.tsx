import type { LanguagePreference } from '../language';
import type { ThemePreference } from '../theme';
import './theme-settings.css';

const themes: { id: ThemePreference; name: { de: string; en: string }; description: { de: string; en: string } }[] = [
  { id: 'light', name: { de: 'Hell', en: 'Light' }, description: { de: 'Ruhiges Neutral', en: 'Quiet neutral' } },
  { id: 'stone', name: { de: 'Stein', en: 'Stone' }, description: { de: 'Warmes Papier', en: 'Warm paper' } },
  { id: 'dark', name: { de: 'Dunkel', en: 'Dark' }, description: { de: 'Gedämpftes Grau', en: 'Muted charcoal' } },
  { id: 'ink', name: { de: 'Tinte', en: 'Ink' }, description: { de: 'Tiefes Schwarz', en: 'Deep black' } },
];

export function ThemeSettings({ theme, language, onChange }: {
  theme: ThemePreference;
  language: LanguagePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return <div className="theme-settings">
    <div className="theme-settings-heading">
      <h4 id="app-theme-heading">{language === 'en' ? 'Theme' : 'Design'}</h4>
      <p>{language === 'en' ? 'Choose a look for this device. You can change it at any time.' : 'Wähle die Darstellung für dieses Gerät. Du kannst sie jederzeit ändern.'}</p>
    </div>
    <fieldset className="theme-settings-options" aria-labelledby="app-theme-heading">
      <legend className="sr-only">{language === 'en' ? 'Theme' : 'Design'}</legend>
      {themes.map((option) => <label key={option.id} className="theme-settings-choice" data-preview-theme={option.id}>
        <input type="radio" name="app-theme" value={option.id} checked={theme === option.id} onChange={() => onChange(option.id)} />
        <span className="theme-settings-preview" aria-hidden="true">
          <span className="theme-settings-preview-sidebar" />
          <span className="theme-settings-preview-work"><i /><b /><i /></span>
        </span>
        <span className="theme-settings-name">{option.name[language]}<small>{option.description[language]}</small></span>
      </label>)}
    </fieldset>
  </div>;
}
