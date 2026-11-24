import { FileJson2, FolderOpen, X } from 'lucide-react';
import './project-import-choice.css';

/** Explain the two different sources before opening a native file picker. */
export function ProjectImportChoice({ onFolder, onPackage, onClose }: { onFolder: () => void; onPackage: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog project-import-choice" role="dialog" aria-modal="true" aria-labelledby="project-import-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="dialog-heading"><div><h2 id="project-import-title">Was möchtest du übernehmen?</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Schließen"><X size={18} /></button></div>
      <p>Ein Codeordner und ein Branchloom-Projektpaket sind verschiedene Dinge. Wähle zuerst, was du bereits hast.</p>
      <div className="project-import-options">
        <div className="project-import-option"><FolderOpen size={21} aria-hidden="true" /><div><h3>Vorhandener Codeordner</h3><p>Gib den Pfad zu einem Ordner mit deinem Projekt ein. Branchloom verknüpft ihn; die Dateien bleiben dort.</p><button className="secondary-button" type="button" onClick={onFolder}>Ordnerpfad eingeben</button></div></div>
        <div className="project-import-option"><FileJson2 size={21} aria-hidden="true" /><div><h3>Branchloom-Projektpaket</h3><p>Wähle eine <code>.json</code>-Datei, die zuvor mit „Projekt sichern“ erstellt wurde. Sie enthält Board, Notizen und Workflow-Entwürfe, aber keinen Codeordner.</p><button className="primary-button" type="button" autoFocus onClick={onPackage}>Projektpaket auswählen</button></div></div>
      </div>
    </section>
  </div>;
}
