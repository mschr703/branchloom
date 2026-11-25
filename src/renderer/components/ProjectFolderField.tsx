import { useState } from 'react';
import './project-folder-field.css';

export function ProjectFolderField({ id, value, onChange, onSelected, onError }: {
  id: string;
  value: string;
  onChange: (path: string) => void;
  onSelected?: (path: string) => void;
  onError: (message: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');

  async function chooseFolder() {
    if (choosing) return;
    setChoosing(true);
    try {
      const path = await window.studio.chooseProjectFolder();
      setError('');
      if (path) {
        onChange(path);
        onSelected?.(path);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      onError(message);
    } finally {
      setChoosing(false);
    }
  }

  return <div className="project-folder-field">
    <label htmlFor={id}>Vorhandener Codeordner</label>
    <div className="project-folder-field-row">
      <input id={id} required value={value} onChange={(event) => onChange(event.target.value)} placeholder="C:\\Projekte\\mein-projekt" />
      <button className="secondary-button" type="button" disabled={choosing} onClick={() => void chooseFolder()}>{choosing ? 'Wähle…' : 'Ordner auswählen'}</button>
    </div>
    {error ? <p className="inline-error" role="alert">Ordnerauswahl fehlgeschlagen: {error}</p> : null}
  </div>;
}
