import type { FormEvent } from 'react';
import type { ProjectPackagePreview } from '../../shared/types';

export function ProjectPackageDialog({ preview, target, onTarget, onClose, onImport }: {
  preview: ProjectPackagePreview;
  target: { name: string; path: string };
  onTarget: (value: { name: string; path: string }) => void;
  onClose: () => void;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="dialog" onSubmit={onImport}>
    <div className="dialog-heading"><div><h2>Projektpaket prüfen</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Schließen">×</button></div>
    <p className="field-help">Das Paket „{preview.name}“ enthält Branchloom-Daten. Wähle zusätzlich einen vorhandenen Codeordner; Projektdateien sind nicht im Paket.</p>
    <p className="field-help">{preview.columns} Spalten · {preview.cards} Karten · {preview.notes} Notizen · {preview.workflows} Workflows</p>
    <p className="field-help">Erstellt ein neues Projekt. Agenten, Autostart und Warteschlange bleiben ausgeschaltet; Workflows starten als Entwürfe mit Freigabe. Sitzungsprotokolle, Browserdaten und Projektdateien sind nicht enthalten. Die JSON-Datei kann persönliche Karten und Notizen enthalten und ist nicht verschlüsselt.</p>
    <label>Name<input autoFocus required maxLength={200} value={target.name} onChange={(event) => onTarget({ ...target, name: event.target.value })} /></label>
    <label>Existierender absoluter Projektordner<input required value={target.path} onChange={(event) => onTarget({ ...target, path: event.target.value })} placeholder="C:\\Projekte\\mein-projekt" /></label>
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button type="submit" className="primary-button">Als neues Projekt importieren</button></div>
  </form></div>;
}
