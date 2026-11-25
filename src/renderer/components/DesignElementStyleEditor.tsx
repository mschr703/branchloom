import { useEffect, useState } from 'react';
import type { DesignElementStyle, DesignInspectionState, DesignSelection } from '../../shared/design-inspection';

type StyleKey = keyof DesignElementStyle;
const fields: Array<{ key: StyleKey; label: string; css: string; kind: 'color' | 'number' }> = [
  { key: 'color', label: 'Textfarbe', css: 'color', kind: 'color' },
  { key: 'backgroundColor', label: 'Fläche', css: 'background-color', kind: 'color' },
  { key: 'borderRadius', label: 'Ecken', css: 'border-radius', kind: 'number' },
  { key: 'fontSize', label: 'Schriftgröße', css: 'font-size', kind: 'number' },
];

function hexFromComputed(value: string | undefined): string {
  const hex = value?.match(/^#([a-f\d]{6})$/i);
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  const rgb = value?.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/);
  if (!rgb) return '#333333';
  return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

function defaults(selection: DesignSelection): Record<StyleKey, string> {
  return {
    color: hexFromComputed(selection.styles.color),
    backgroundColor: hexFromComputed(selection.styles.backgroundColor),
    borderRadius: String(Math.min(64, Math.max(0, parseFloat(selection.styles.borderRadius ?? '') || 0))),
    fontSize: String(Math.min(48, Math.max(8, parseFloat(selection.styles.fontSize ?? '') || 16))),
  };
}

function styleDescription(selection: DesignSelection, style: DesignElementStyle): string {
  const lines = fields.filter((field) => style[field.key]).map((field) => `- ${field.css}: ${style[field.key]}`);
  return `Please implement the following visual change for the selected element in the project source.\n\nSource route: ${selection.sourceUrl}\nElement: ${selection.tag} (${selection.selector})\nRequested CSS values:\n${lines.join('\n')}\n\nThe inline browser preview was temporary. Identify the owning component and existing design tokens before editing. Check responsive states and verify the result in the running app.`;
}

export function DesignElementStyleEditor({ projectId, selections, state, onPreviewState, onPrepare }: {
  projectId: string;
  selections: DesignSelection[];
  state: DesignInspectionState;
  onPreviewState: (next: DesignInspectionState) => void;
  onPrepare: (selectionId: string, description: string) => void;
}) {
  const [selectionId, setSelectionId] = useState(selections[0]?.id ?? '');
  const selection = selections.find((item) => item.id === selectionId) ?? selections[0];
  const [values, setValues] = useState<Record<StyleKey, string>>(() => selection ? defaults(selection) : { color: '#333333', backgroundColor: '#ffffff', borderRadius: '0', fontSize: '16' });
  const [enabled, setEnabled] = useState<StyleKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = state.elementPreview;
  const matchingRoute = Boolean(selection && state.ready && state.sourceUrl === selection.sourceUrl);

  useEffect(() => {
    if (!selection) return;
    setValues(defaults(selection));
    setEnabled([]);
    setError('');
  }, [selection?.id]);

  useEffect(() => {
    if (active?.selectionId && active.selectionId !== selectionId) setSelectionId(active.selectionId);
  }, [active?.selectionId, selectionId]);

  function draft(): DesignElementStyle {
    const style: DesignElementStyle = {};
    for (const field of fields) {
      if (!enabled.includes(field.key)) continue;
      style[field.key] = field.kind === 'number' ? `${values[field.key]}px` : values[field.key];
    }
    return style;
  }

  async function preview() {
    if (!selection || busy || active) return;
    setBusy(true); setError('');
    try {
      onPreviewState(await window.studio.designInspectionApplyElementPreview({ projectId, selectionId: selection.id, style: draft() }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (busy || !active) return;
    setBusy(true); setError('');
    try { onPreviewState(await window.studio.designInspectionResetElementPreview(projectId)); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      const current = await window.studio.designInspectionState().catch(() => null);
      if (current?.projectId === projectId) onPreviewState(current);
    }
    finally { setBusy(false); }
  }

  return <section className="design-element-editor" aria-label="Elementstil testen">
    <div className="design-element-editor-heading"><div><h3>Elementstil</h3><p>Wähle Werte, prüfe sie direkt in der lokalen App und übernimm den Wunsch als Kartenentwurf.</p></div><span>{active ? 'Flüchtige Vorschau aktiv' : 'Noch nichts geändert'}</span></div>
    {selections.length ? <>
      <label className="design-element-editor-selection">Element
        <select value={selection?.id ?? ''} disabled={busy || Boolean(active)} onChange={(event) => setSelectionId(event.target.value)}>
          {selections.map((item) => <option key={item.id} value={item.id}>{item.tag} · {item.selector} · {new Date(item.capturedAt).toLocaleTimeString('de-DE')}</option>)}
        </select>
      </label>
      {!matchingRoute ? <p className="design-element-editor-note">Öffne die gespeicherte Quellroute und wähle das Element bei Änderungen erneut.</p> : null}
      <div className="design-element-editor-fields">
        {fields.map((field) => <label key={field.key} className="design-element-editor-field">
          <input type="checkbox" checked={enabled.includes(field.key)} disabled={busy || Boolean(active)} onChange={(event) => setEnabled((old) => event.target.checked ? [...old, field.key] : old.filter((key) => key !== field.key))} />
          <span>{field.label}</span>
          <input aria-label={field.label + ' Wert'} type={field.kind === 'color' ? 'color' : 'number'} min={field.key === 'fontSize' ? 8 : 0} max={field.key === 'fontSize' ? 48 : 64} step={field.kind === 'number' ? 0.1 : undefined} value={values[field.key]} disabled={busy || Boolean(active) || !enabled.includes(field.key)} onChange={(event) => setValues((old) => ({ ...old, [field.key]: event.target.value }))} />
          {field.kind === 'number' ? <small>px</small> : <code>{values[field.key]}</code>}
        </label>)}
      </div>
      <div className="design-element-editor-actions">
        <button type="button" className="secondary-button" disabled={!matchingRoute || !enabled.length || busy || Boolean(active) || Boolean(state.themePreview)} onClick={() => void preview()}>In Vorschau testen</button>
        <button type="button" className="secondary-button" disabled={!active || busy} onClick={() => void reset()}>Vorschau zurücksetzen</button>
        <button type="button" className="primary-button" disabled={!active || active.selectionId !== selection?.id || busy} onClick={() => selection && active && onPrepare(selection.id, styleDescription(selection, active.style))}>Als Karte vorbereiten</button>
      </div>
      {active ? <p className="design-element-editor-note" role="status">Nur der aktuelle Browserstil ist geändert. Projektdateien werden erst durch einen späteren, gesonderten Agentenauftrag bearbeitet.</p> : null}
    </> : <p className="design-element-editor-note">Wähle zuerst ein Element in der laufenden App aus.</p>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
