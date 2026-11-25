import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { WireframeElement, WireframeInteraction } from '../../shared/card-wireframe';
import './wireframe-interaction.css';

const initial = (button: WireframeElement, panel: WireframeElement): WireframeInteraction => ({
  triggerElementId: button.id, panelElementId: panel.id, trigger: 'click', action: 'toggle-panel',
  durationMs: 240, enterOffsetPx: 24, closedOpacity: 0, reducedMotionDurationMs: 0,
  focusOnOpen: 'panel', focusOnClose: 'trigger',
});

export function WireframeInteractionEditor({ elements, interactions, disabled, onChange }: {
  elements: WireframeElement[]; interactions: WireframeInteraction[]; disabled: boolean;
  onChange: (next: WireframeInteraction[]) => void;
}) {
  const buttons = elements.filter((item) => item.kind === 'button');
  const panels = elements.filter((item) => item.kind === 'panel');
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const suppressFocusOpen = useRef(false);
  const interaction = interactions[selected] ?? null;
  const selectedButton = buttons.find((item) => item.id === interaction?.triggerElementId);
  const selectedPanel = panels.find((item) => item.id === interaction?.panelElementId);
  const usedPair = (id: string, trigger: WireframeInteraction['trigger']) =>
    interactions.some((item, index) => index !== selected && item.triggerElementId === id && item.trigger === trigger);
  const nextPair = (['click', 'hover', 'focus'] as const).flatMap((trigger) => buttons.map((button) => ({ button, trigger })))
    .find(({ button, trigger }) => !interactions.some((item) => item.triggerElementId === button.id && item.trigger === trigger));

  useLayoutEffect(() => { suppressFocusOpen.current = false; setOpen(false); }, [selected, interaction?.triggerElementId, interaction?.panelElementId, interaction?.trigger]);
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);
  useEffect(() => { if (selected >= interactions.length) setSelected(Math.max(0, interactions.length - 1)); }, [interactions.length, selected]);
  function replace(next: WireframeInteraction) {
    const updated = [...interactions]; updated[selected] = next; onChange(updated);
  }
  function add() {
    if (!nextPair || !panels[0]) return;
    onChange([...interactions, { ...initial(nextPair.button, panels[0]), trigger: nextPair.trigger }]);
    setSelected(interactions.length);
  }
  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) {
      suppressFocusOpen.current = interaction?.trigger === 'focus' || interaction?.trigger === 'hover';
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }
  function focusTrigger() {
    if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; }
    if (interaction?.trigger === 'focus' || interaction?.trigger === 'hover') setOpen(true);
  }
  const duration = reduced ? 0 : interaction?.durationMs ?? 0;
  const midpoint = interaction?.midpoint;
  const style = { '--interaction-duration': `${duration}ms`, '--interaction-offset': `${interaction?.enterOffsetPx ?? 0}px`, '--interaction-opacity': interaction?.closedOpacity ?? 0,
    '--interaction-mid-offset': `${midpoint?.offsetPx ?? 0}px`, '--interaction-mid-opacity': midpoint?.opacity ?? 1 } as CSSProperties;
  return <section className="wireframe-interaction" aria-label="Interaktionen">
    <div className="wireframe-interaction-heading"><h3>Interaktionen</h3><span>Desktop · {interactions.length}/8</span></div>
    <p>Jede Zeile verbindet einen Knopf mit einer Fläche. Wähle eine Zeile, um ihren Ablauf zu bearbeiten und auszuprobieren.</p>
    {interactions.length ? <ol className="wireframe-interaction-track" aria-label="Interaktionsabläufe">{interactions.map((item, index) => {
      const button = buttons.find((element) => element.id === item.triggerElementId);
      const panel = panels.find((element) => element.id === item.panelElementId);
      return <li key={`${item.triggerElementId}:${item.trigger}`}><button type="button" className={index === selected ? 'is-selected' : ''} aria-current={index === selected ? 'step' : undefined} onClick={() => setSelected(index)}>
        <span className="wireframe-interaction-track-label"><strong>{button?.text || 'Knopf'} → {panel?.text || 'Fläche'}</strong><small>{item.trigger === 'click' ? 'Klick' : item.trigger === 'hover' ? 'Zeigerkontakt' : 'Fokus'}</small></span>
        <span className="wireframe-interaction-track-time"><span className="wireframe-interaction-track-bar" style={{ width: `${Math.max(10, item.durationMs / 10)}%` }} /><small>{item.durationMs} ms</small></span>
      </button></li>;
    })}</ol> : null}
    <button type="button" className="secondary-button small" disabled={disabled || !nextPair || !panels.length || interactions.length >= 8} onClick={add}>{interactions.length ? 'Weiteren Ablauf hinzufügen' : 'Klick → Fläche anlegen'}</button>
    {interaction ? <>
      <div className="wireframe-interaction-fields">
        <label>Auslösung<select aria-label="Interaktion Auslösung" disabled={disabled} value={interaction.trigger} onChange={(event) => { const trigger = event.target.value as WireframeInteraction['trigger']; if (!usedPair(interaction.triggerElementId, trigger)) replace({ ...interaction, trigger }); }}>{(['click', 'hover', 'focus'] as const).map((trigger) => <option key={trigger} value={trigger} disabled={usedPair(interaction.triggerElementId, trigger)}>{trigger === 'click' ? 'Klick' : trigger === 'hover' ? 'Zeigerkontakt' : 'Tastaturfokus'}</option>)}</select></label>
        <label>Auslöser<select aria-label="Interaktion Auslöser" disabled={disabled} value={interaction.triggerElementId} onChange={(event) => { if (!usedPair(event.target.value, interaction.trigger)) replace({ ...interaction, triggerElementId: event.target.value }); }}>{buttons.map((item) => <option key={item.id} value={item.id} disabled={usedPair(item.id, interaction.trigger)}>{item.text || 'Knopf'} · {item.id}</option>)}</select></label>
        <label>Zielfläche<select aria-label="Interaktion Zielfläche" disabled={disabled} value={interaction.panelElementId} onChange={(event) => replace({ ...interaction, panelElementId: event.target.value })}>{panels.map((item) => <option key={item.id} value={item.id}>{item.text || 'Fläche'} · {item.id}</option>)}</select></label>
        <label>Dauer <output>{interaction.durationMs} ms</output><input aria-label="Interaktion Dauer" type="range" min={100} max={1000} step={20} disabled={disabled} value={interaction.durationMs} onChange={(event) => replace({ ...interaction, durationMs: Number(event.target.value) })} /></label>
        <label>Versatz <output>{interaction.enterOffsetPx} px</output><input aria-label="Interaktion Versatz" type="range" min={0} max={80} step={4} disabled={disabled} value={interaction.enterOffsetPx} onChange={(event) => replace({ ...interaction, enterOffsetPx: Number(event.target.value) })} /></label>
        <label>Startdeckkraft <output>{Math.round(interaction.closedOpacity * 100)} %</output><input aria-label="Interaktion Startdeckkraft" type="range" min={0} max={0.5} step={0.05} disabled={disabled} value={interaction.closedOpacity} onChange={(event) => replace({ ...interaction, closedOpacity: Number(event.target.value) })} /></label>
      </div>
      <div className="wireframe-interaction-timing" aria-label="Zeitlicher Ablauf"><span>0 ms · {interaction.trigger === 'click' ? 'Klick' : interaction.trigger === 'hover' ? 'Zeigerkontakt' : 'Fokus'}</span><span>{interaction.durationMs} ms · Fläche sichtbar</span></div>
      <div className="wireframe-interaction-timeline" aria-label="Eintritts-Zeitspur">
        <div className="wireframe-interaction-timeline-rail" aria-hidden="true"><i className="is-start" />{midpoint ? <i className="is-mid" style={{ left: `${midpoint.atPercent}%` }} /> : null}<i className="is-end" /></div>
        <div className="wireframe-interaction-timeline-legend"><span>Start · {interaction.enterOffsetPx} px / {Math.round(interaction.closedOpacity * 100)} %</span>{midpoint ? <span>{Math.round(interaction.durationMs * midpoint.atPercent / 100)} ms · {midpoint.offsetPx} px / {Math.round(midpoint.opacity * 100)} %</span> : null}<span>Ende · 0 px / 100 %</span></div>
      </div>
      {midpoint ? <div className="wireframe-interaction-midpoint">
        <div className="wireframe-interaction-midpoint-heading"><strong>Zwischenpunkt</strong><button type="button" className="text-button" disabled={disabled} onClick={() => { const next = { ...interaction }; delete next.midpoint; replace(next); }}>Entfernen</button></div>
        <div className="wireframe-interaction-fields">
          <label>Zeitpunkt<select aria-label="Zwischenpunkt Zeitpunkt" disabled={disabled} value={midpoint.atPercent} onChange={(event) => replace({ ...interaction, midpoint: { ...midpoint, atPercent: Number(event.target.value) as 25 | 50 | 75 } })}><option value={25}>25 %</option><option value={50}>50 %</option><option value={75}>75 %</option></select></label>
          <label>Versatz <output>{midpoint.offsetPx} px</output><input aria-label="Zwischenpunkt Versatz" type="range" min={0} max={80} step={4} disabled={disabled} value={midpoint.offsetPx} onChange={(event) => replace({ ...interaction, midpoint: { ...midpoint, offsetPx: Number(event.target.value) } })} /></label>
          <label>Deckkraft <output>{Math.round(midpoint.opacity * 100)} %</output><input aria-label="Zwischenpunkt Deckkraft" type="range" min={0} max={1} step={0.05} disabled={disabled} value={midpoint.opacity} onChange={(event) => replace({ ...interaction, midpoint: { ...midpoint, opacity: Number(event.target.value) } })} /></label>
        </div>
      </div> : <button type="button" className="text-button" disabled={disabled} onClick={() => replace({ ...interaction, midpoint: { atPercent: 50, offsetPx: Math.round(interaction.enterOffsetPx / 2), opacity: Math.min(1, Math.round((1 + interaction.closedOpacity) * 10) / 20) } })}>Zwischenpunkt hinzufügen</button>}
      <p className="wireframe-interaction-focus">Fokusvorgabe: Beim Öffnen auf die Fläche; mit Schließen oder Escape zurück auf den Auslöser. {interaction.trigger === 'hover' ? 'Tastaturfokus öffnet als Alternative. Verlassen der Vorschau schließt die Fläche.' : interaction.trigger === 'focus' ? 'Tab aus der Vorschau schließt ohne Fokusfalle.' : ''} Reduzierte Bewegung: 0 ms.</p>
      <label className="wireframe-interaction-reduced"><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />Reduzierte Bewegung vorschauen</label>
      <div className="wireframe-interaction-preview" style={style} aria-label="Interaktionsvorschau" onPointerLeave={() => { if (interaction.trigger === 'hover' && open) close(); }} onBlurCapture={(event) => {
        if ((interaction.trigger !== 'focus' && interaction.trigger !== 'hover') || !open) return;
        const preview = event.currentTarget;
        requestAnimationFrame(() => { if (preview.isConnected && !preview.contains(document.activeElement)) setOpen(false); });
      }}>
        <button ref={triggerRef} type="button" className="secondary-button small" aria-controls={panelId} aria-expanded={open} onFocus={focusTrigger} onPointerEnter={() => { if (interaction.trigger === 'hover') setOpen(true); }} onClick={() => { if (interaction.trigger === 'click') open ? close() : setOpen(true); }}>{selectedButton?.text || 'Fläche umschalten'}</button>
        <div className={`wireframe-interaction-backdrop${open ? ' is-open' : ''}`} aria-hidden="true" />
        <div ref={panelRef} id={panelId} className={`wireframe-interaction-panel${open ? ' is-open' : ''}${midpoint ? ` has-midpoint at-${midpoint.atPercent}` : ''}`} tabIndex={open ? -1 : undefined} role="region" aria-label={selectedPanel?.text || 'Geöffnete Fläche'} aria-hidden={!open} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
          <strong>{selectedPanel?.text || 'Fläche'}</strong><button type="button" className="secondary-button small" tabIndex={open ? 0 : -1} onClick={() => close()}>Schließen</button>
        </div>
      </div>
      <button type="button" className="text-button" disabled={disabled} onClick={() => { onChange(interactions.filter((_, index) => index !== selected)); setOpen(false); setSelected(Math.max(0, selected - 1)); }}>Ausgewählten Ablauf entfernen</button>
    </> : null}
    {!buttons.length || !panels.length ? <p className="wireframe-interaction-hint">Für eine Interaktion brauchst du im Desktop-Entwurf einen Knopf und eine Fläche.</p> : null}
  </section>;
}
