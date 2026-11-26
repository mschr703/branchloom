import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import type { DesignInspectionState, DesignSelection } from '../../shared/design-inspection';
import type { DesignStateRoute } from '../../shared/design-state-routes';
import type { DesignA11yCheck } from '../../shared/design-a11y';
import { ComponentCatalogPanel } from './ComponentCatalogPanel';
import { ThemeTokensPanel } from './ThemeTokensPanel';
import { DesignViewportCanvas } from './DesignViewportCanvas';
import { DesignStateRoutes } from './DesignStateRoutes';
import { DesignVoiceTask } from './DesignVoiceTask';
import { DesignElementStyleEditor } from './DesignElementStyleEditor';
import { TaskWireframeEditor } from './TaskWireframeEditor';
import { DesignProjectOverview } from './DesignProjectOverview';
import type { Card, Column, ProjectQaCapture, ProjectQaCaptureIndex, QueueState } from '../../shared/types';
import type { ProjectWireframeIndex } from '../../shared/card-wireframe';
import './design-inspection.css';

const emptyState: DesignInspectionState = { projectId: null, sourceUrl: null, ready: false, armed: false, themePreview: null };
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const nextFrameOrTimeout = (): Promise<void> => new Promise((resolve) => {
  let done = false;
  let frame = 0;
  const finish = () => { if (done) return; done = true; clearTimeout(timer); cancelAnimationFrame(frame); resolve(); };
  const timer = setTimeout(finish, 150);
  frame = requestAnimationFrame(finish);
});

export function DesignInspectionView({ projectId, active, cards, startCardId, columns, queueState, onOpenCard, onCreated }: { projectId: string; active: boolean; cards: Card[]; startCardId?: string | null; columns: Column[]; queueState: QueueState; onOpenCard: (cardId: string) => void | Promise<void>; onCreated: () => void | Promise<void> }) {
  const [url, setUrl] = useState('');
  const [selector, setSelector] = useState('');
  const [state, setState] = useState<DesignInspectionState>(emptyState);
  const [selections, setSelections] = useState<DesignSelection[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [a11yCheck, setA11yCheck] = useState<DesignA11yCheck | null>(null);
  const [a11yBusyId, setA11yBusyId] = useState<string | null>(null);
  const [a11yError, setA11yError] = useState<{ id: string; message: string } | null>(null);
  const [voiceSelectionId, setVoiceSelectionId] = useState<string | null>(null);
  const [styleRequest, setStyleRequest] = useState<{ selectionId: string; description: string } | null>(null);
  const [wireframeFocus, setWireframeFocus] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'overview' | 'draft' | 'preview'>(startCardId ? 'draft' : 'overview');
  const [openedCardId, setOpenedCardId] = useState<string | null>(startCardId ?? null);
  const [referenceCapture, setReferenceCapture] = useState<{ capture: ProjectQaCapture; image: string } | null>(null);
  const [editorOpenRevision, setEditorOpenRevision] = useState(0);
  const [wireframeIndex, setWireframeIndex] = useState<{ projectId: string; index: ProjectWireframeIndex } | null>(null);
  const [wireframeIndexError, setWireframeIndexError] = useState('');
  const [wireframeIndexLoading, setWireframeIndexLoading] = useState(false);
  const [wireframeIndexRevision, setWireframeIndexRevision] = useState(0);
  const [qaCaptureIndex, setQaCaptureIndex] = useState<{ projectId: string; index: ProjectQaCaptureIndex } | null>(null);
  const [qaCaptureError, setQaCaptureError] = useState('');
  const [qaCaptureLoading, setQaCaptureLoading] = useState(false);
  const [qaCaptureRevision, setQaCaptureRevision] = useState(0);
  const [focusPending, setFocusPending] = useState(false);
  const focusTransition = useRef(false);
  const focused = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;

  const syncBounds = useCallback(async () => {
    if (focused.current || workspaceMode !== 'preview') return;
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    try { await window.studio.designInspectionSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }); }
    catch (reason) { setError(messageOf(reason)); }
  }, [workspaceMode]);

  async function changeWireframeFocus(next: boolean) {
    if (focusTransition.current || next === focused.current) return;
    if (next && (!active || busy || state.armed)) return;
    focusTransition.current = true;
    setFocusPending(true);
    try {
      focused.current = next;
      if (next) await window.studio.designInspectionSetBounds(null);
      setWireframeFocus(next);
      setWorkspaceMode('draft');
    } catch (reason) {
      focused.current = !next;
      setError(messageOf(reason));
    } finally {
      focusTransition.current = false;
      setFocusPending(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    focused.current = false;
    setWireframeFocus(false);
    setWorkspaceMode(startCardId ? 'draft' : 'overview');
    setOpenedCardId(startCardId ?? null);
    setReferenceCapture(null);
    setWireframeIndex(null); setWireframeIndexError(''); setQaCaptureIndex(null); setQaCaptureError('');
    setSelections([]); setState(emptyState); setError(''); setUrl(''); setSelector(''); setA11yCheck(null); setA11yError(null); setA11yBusyId(null); setVoiceSelectionId(null); setStyleRequest(null);
    void window.studio.designSelections(projectId).then((items) => { if (mounted) setSelections(items); }).catch((reason: unknown) => { if (mounted) setError(messageOf(reason)); });
    const unsubscribe = window.studio.onDesignSelection((selection) => {
      if (!mounted || selection.projectId !== projectId) return;
      setSelections((items) => [selection, ...items.filter((item) => item.id !== selection.id)].slice(0, 20));
      setA11yCheck(null); setA11yError(null);
      setVoiceSelectionId(null); setStyleRequest(null);
      setState((old) => ({ ...old, armed: false }));
    });
    return () => { mounted = false; unsubscribe(); void window.studio.designInspectionSetVisible(false).catch(() => undefined); };
  }, [projectId]);

  useEffect(() => {
    if (!startCardId) return;
    setOpenedCardId(startCardId);
    setWorkspaceMode('draft');
  }, [startCardId]);

  useEffect(() => {
    if (!active || workspaceMode !== 'overview') return;
    let mounted = true;
    setWireframeIndexLoading(true); setWireframeIndexError('');
    void window.studio.listProjectWireframes(projectId).then((index) => { if (mounted) setWireframeIndex({ projectId, index }); })
      .catch((reason: unknown) => { if (mounted) { setWireframeIndex(null); setWireframeIndexError(messageOf(reason)); } })
      .finally(() => { if (mounted) setWireframeIndexLoading(false); });
    return () => { mounted = false; };
  }, [projectId, active, workspaceMode, wireframeIndexRevision]);

  useEffect(() => {
    if (!active || workspaceMode !== 'overview') return;
    let mounted = true;
    setQaCaptureLoading(true); setQaCaptureError('');
    void window.studio.listProjectQaCaptures(projectId).then((index) => { if (mounted) setQaCaptureIndex({ projectId, index }); })
      .catch((reason: unknown) => { if (mounted) { setQaCaptureIndex(null); setQaCaptureError(messageOf(reason)); } })
      .finally(() => { if (mounted) setQaCaptureLoading(false); });
    return () => { mounted = false; };
  }, [projectId, active, workspaceMode, qaCaptureRevision]);

  useEffect(() => {
    if (!active) { setA11yCheck(null); setA11yError(null); setVoiceSelectionId(null); setStyleRequest(null); void window.studio.designInspectionSetVisible(false).then(setState).catch(() => undefined); return; }
    void window.studio.designInspectionSetVisible(true).then(setState).catch((reason: unknown) => setError(messageOf(reason)));
    return () => { void window.studio.designInspectionSetVisible(false).catch(() => undefined); };
  }, [active]);

  useEffect(() => {
    if (!active || wireframeFocus || workspaceMode !== 'preview') {
      void window.studio.designInspectionSetBounds(null).catch((reason: unknown) => setError(messageOf(reason)));
      return;
    }
    const element = viewport.current;
    if (!element) return;
    let scheduled = 0;
    const update = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(() => { void syncBounds(); }); };
    const observer = new ResizeObserver(update);
    const intersection = new IntersectionObserver(update);
    observer.observe(element);
    intersection.observe(element);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    return () => { cancelAnimationFrame(scheduled); observer.disconnect(); intersection.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [active, wireframeFocus, workspaceMode, syncBounds]);

  useEffect(() => {
    if (!styleRequest || voiceSelectionId !== styleRequest.selectionId) return;
    const frame = requestAnimationFrame(() => document.querySelector('.design-voice-task')?.scrollIntoView?.({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [styleRequest, voiceSelectionId]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setA11yCheck(null); setA11yError(null);
    setPreviewRevision((value) => value + 1);
    try {
      setState(await window.studio.designInspectionStart({ projectId, url }));
      await nextFrameOrTimeout();
      viewport.current?.scrollIntoView({ block: 'nearest' });
      await nextFrameOrTimeout();
      await syncBounds();
    }
    catch (reason) { setState(emptyState); setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function openStateRoute(route: DesignStateRoute) {
    if (busy || a11yBusyId || !active) throw new Error('Warte, bis die Design-Vorschau bereit ist.');
    setBusy(true); setError(''); setA11yCheck(null); setA11yError(null);
    try {
      const opened = await window.studio.openDesignStateRoute({ projectId, kind: route.kind });
      if (currentProject.current !== projectId) return;
      setState(opened); setUrl(route.url); setPreviewRevision((value) => value + 1); setA11yCheck(null); setA11yError(null);
    } catch (reason) {
      const current = await window.studio.designInspectionState().catch(() => emptyState);
      if (currentProject.current === projectId) setState(current);
      throw reason;
    } finally { if (currentProject.current === projectId) setBusy(false); }
  }

  async function arm() {
    setError('');
    try {
      viewport.current?.scrollIntoView({ block: 'nearest' });
      await nextFrameOrTimeout();
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) throw new Error('Die Vorschau ist nicht sichtbar.');
      await window.studio.designInspectionSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      setState(await window.studio.designInspectionArm(projectId));
    }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function selectBySelector(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.ready || busy) return;
    setBusy(true); setError('');
    try { await window.studio.designInspectionSelectSelector({ projectId, selector }); setState((old) => ({ ...old, armed: false })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function checkA11y(selection: DesignSelection) {
    if (a11yBusyId) return;
    setA11yBusyId(selection.id); setA11yCheck(null); setA11yError(null);
    try {
      const result = await window.studio.designInspectionCheckA11y({ projectId, selectionId: selection.id });
      if (currentProject.current === projectId) setA11yCheck(result);
    } catch (reason) { if (currentProject.current === projectId) setA11yError({ id: selection.id, message: messageOf(reason) }); }
    finally { if (currentProject.current === projectId) setA11yBusyId(null); }
  }

  const previewActive = active && !wireframeFocus && workspaceMode === 'preview';
  return <section className={`design-inspection${wireframeFocus ? ' wireframe-focus' : ''}`} aria-label="Design-Arbeitsbereich">
    {!wireframeFocus ? <nav className="design-workspace-modes" aria-label="Design-Ansicht wählen"><button type="button" aria-pressed={workspaceMode === 'overview'} onClick={() => setWorkspaceMode('overview')}>Übersicht</button><button type="button" aria-pressed={workspaceMode === 'draft'} onClick={() => setWorkspaceMode('draft')}>Entwurf</button><button type="button" aria-pressed={workspaceMode === 'preview'} onClick={() => setWorkspaceMode('preview')}>Laufende App prüfen{state.ready ? <span aria-label="Vorschau geöffnet" className="design-workspace-preview-indicator" /> : null}</button></nav> : null}
    <div hidden={workspaceMode !== 'overview'}><DesignProjectOverview cards={cards} index={wireframeIndex?.projectId === projectId ? wireframeIndex.index : null} captures={qaCaptureIndex?.projectId === projectId ? qaCaptureIndex.index : null} selections={selections.filter((item) => item.projectId === projectId)} loading={wireframeIndexLoading} error={wireframeIndexError} captureLoading={qaCaptureLoading} captureError={qaCaptureError} onRetry={() => setWireframeIndexRevision((value) => value + 1)} onRetryCaptures={() => setQaCaptureRevision((value) => value + 1)} onOpenDraft={(cardId) => { setReferenceCapture(null); setOpenedCardId(cardId ?? null); setEditorOpenRevision((value) => value + 1); setWorkspaceMode('draft'); if (cardId) void changeWireframeFocus(true); }} onOpenQaCard={onOpenCard} onOpenReference={(capture, image) => { setReferenceCapture({ capture, image }); setOpenedCardId(capture.cardId); setEditorOpenRevision((value) => value + 1); setWorkspaceMode('draft'); void changeWireframeFocus(true); }} onOpenPreview={() => setWorkspaceMode('preview')} /></div>
    <div className="design-workspace-draft" hidden={workspaceMode !== 'draft'}><TaskWireframeEditor key={`${projectId}:${openedCardId ?? 'last'}:${editorOpenRevision}`} projectId={projectId} cards={cards} startCardId={openedCardId} referenceCapture={referenceCapture} focusMode={wireframeFocus} focusPending={focusPending} canEnterFocus={active && !busy && !state.armed} onFocusModeChange={(next) => void changeWireframeFocus(next)} /></div>
    <div className="design-inspection-tools" hidden={!previewActive}>
    <div className="design-inspection-intro"><div><h2>Design-Inspektion</h2><p>Öffne eine laufende lokale Vorschau. Wähle anschließend genau ein Element; Branchloom speichert dessen begrenzte CSS-Belege nur in diesem Projekt.</p></div></div>
    <form className="design-inspection-toolbar" onSubmit={(event) => void start(event)}>
      <label>Lokale Vorschau-URL<input type="url" required maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:5173/" /></label>
      <button className="secondary-button" type="submit" disabled={busy || !url.trim()}>{busy ? 'Öffne…' : 'Vorschau öffnen'}</button>
      <button className="primary-button" type="button" disabled={!state.ready || busy || state.armed || !active || Boolean(state.elementPreview)} onClick={() => void arm()}><MousePointer2 size={15} aria-hidden="true" />{state.armed ? 'Element anklicken…' : 'Element auswählen'}</button>
    </form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <p className="design-inspection-state" role="status">{state.armed ? 'Auswahl aktiv: Klicke ein Element in der Vorschau. Der Seitenklick wird abgefangen.' : state.ready ? `Vorschau geladen: ${state.sourceUrl}` : 'Noch keine Vorschau geöffnet.'}</p>
    <DesignStateRoutes key={projectId} projectId={projectId} active={previewActive} previewBusy={busy || Boolean(a11yBusyId)} themePreviewActive={Boolean(state.themePreview || state.elementPreview)} onOpen={openStateRoute} />
    <details className="design-inspection-selector"><summary>Mit Tastatur oder CSS-Selektor auswählen</summary><form onSubmit={(event) => void selectBySelector(event)}><label>CSS-Selektor<input value={selector} maxLength={320} disabled={!state.ready || busy} onChange={(event) => setSelector(event.target.value)} placeholder="#header oder main button" /></label><button className="secondary-button" type="submit" disabled={!state.ready || busy || !selector.trim()}>Element prüfen</button></form></details>
    <div className="design-inspection-live-layout">
      <div className="design-inspection-viewport" ref={viewport} aria-label="Lokale Design-Vorschau">{!state.ready ? <p>Die laufende Seite erscheint hier nach „Vorschau öffnen“.</p> : null}</div>
      <DesignElementStyleEditor projectId={projectId} selections={selections} state={state} onPreviewState={(next) => { setState(next); setA11yCheck(null); }} onPrepare={(selectionId, description) => { setStyleRequest({ selectionId, description }); setVoiceSelectionId(selectionId); }} />
    </div>
    <DesignViewportCanvas projectId={projectId} ready={state.ready && previewActive} themePreviewActive={Boolean(state.themePreview || state.elementPreview)} revision={previewRevision} />
    <div className="design-inspection-evidence"><h3>Ausgewählte Elemente</h3>
      {selections.length === 0 ? <p>Für dieses Projekt ist noch kein Element gespeichert.</p> : <ol>{selections.map((item) => <li key={item.id}>
        <div className="design-inspection-item-head"><strong><code>{item.selector}</code></strong><time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString('de-DE')}</time></div>
        <p><span>Tag: <code>{item.tag}</code></span><span>Quelle: {item.sourceUrl}</span>{item.text ? <span>Text: {item.text}</span> : null}</p>
        <dl>{Object.entries(item.styles).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        <div className="design-a11y-check">
          <button type="button" className="secondary-button" disabled={!active || !state.ready || busy || Boolean(a11yBusyId)} onClick={() => void checkA11y(item)}>{a11yBusyId === item.id ? 'Prüfe…' : 'Kontrast und Zielgröße prüfen'}</button>
          {a11yError?.id === item.id ? <p className="inline-error" role="alert">{a11yError.message}</p> : null}
          {a11yCheck?.selectionId === item.id ? <div className="design-a11y-result" role="status">
            <p>Aktuelle lokale Vorschau · <time dateTime={a11yCheck.checkedAt}>{new Date(a11yCheck.checkedAt).toLocaleString('de-DE')}</time></p>
            <dl>
              <div><dt>Textkontrast</dt><dd>{a11yCheck.contrast.ratio === null ? a11yCheck.contrast.reason : `${(Math.floor(a11yCheck.contrast.ratio * 1000) / 1000).toFixed(3)}:1 · ${a11yCheck.contrast.belowBodyTextReference ? 'unter' : 'ab'} 4,5:1 Referenz für normalen Text`}</dd></div>
              <div><dt>Interaktives Ziel</dt><dd>{!a11yCheck.target.interactive ? 'Kein erkanntes interaktives Element.' : a11yCheck.target.width === null || a11yCheck.target.height === null ? 'Größe nicht messbar.' : `${a11yCheck.target.width} × ${a11yCheck.target.height} CSS-px · ${a11yCheck.target.belowSizeReference ? 'unter' : 'ab'} 24 × 24 px Referenz`}</dd></div>
            </dl>
            <p className="design-a11y-limit">Einzelmessung mit vereinfachten Grenzwerten; kein vollständiger Barrierefreiheitstest.</p>
          </div> : null}
        </div>
        {item.tokens.length ? <details><summary>{item.tokens.length} CSS-Variablen am Element</summary><dl>{item.tokens.map((token) => <div key={token.name}><dt>{token.name}</dt><dd>{token.value}</dd></div>)}</dl></details> : <small>Keine berechneten CSS-Variablen erfasst.</small>}
        <div className="design-voice-entry"><button type="button" className="secondary-button" disabled={!active || busy || Boolean(a11yBusyId)} aria-expanded={voiceSelectionId === item.id} onClick={() => { setStyleRequest(null); setVoiceSelectionId((current) => current === item.id ? null : item.id); }}>{voiceSelectionId === item.id ? 'Wunsch schließen' : 'Wunsch als Karte vorbereiten'}</button></div>
        {active && voiceSelectionId === item.id ? <DesignVoiceTask key={item.id + (styleRequest?.selectionId === item.id ? styleRequest.description : '')} projectId={projectId} selection={item} prefillDescription={styleRequest?.selectionId === item.id ? styleRequest.description : ''} columns={columns} queueState={queueState} onOpenCard={onOpenCard} onCreated={onCreated} onCancel={() => { setVoiceSelectionId(null); setStyleRequest(null); }} /> : null}
      </li>)}</ol>}
    </div>
    <ComponentCatalogPanel projectId={projectId} />
    <ThemeTokensPanel projectId={projectId} previewState={active ? state : emptyState} onPreviewState={(next) => { setState(next); setA11yCheck(null); setA11yError(null); }} />
    <p className="design-inspection-limit">Die Auswahl und die freiwillige Einzelprüfung lesen berechnete Werte aus einer lokalen Seite. Sie ändern keine Projektdateien und starten keinen Agenten. Die Seite führt beim Laden weiterhin eigenes JavaScript aus.</p>
    </div>
  </section>;
}
