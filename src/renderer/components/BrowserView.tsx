import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe2, Plus, RotateCw, X } from 'lucide-react';
import type { BrowserDiagnostic, BrowserState, ProjectSnapshot } from '../../shared/types';
import type { BugCaptureDraft, BugReplayTarget } from '../../shared/bug-replay';
import './browser-diagnostics.css';

const EMPTY: BrowserState = { tabs: [], activeTabId: null, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null, diagnostics: [] };
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function BrowserView({ active, snapshot = null, onOpenCard, onOpenSettings }: { active: boolean; snapshot?: ProjectSnapshot | null; onOpenCard?: (cardId: string) => Promise<void> | void; onOpenSettings?: () => void }) {
  const [state, setState] = useState<BrowserState>(EMPTY);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState<string | null>(null);
  const [reproduction, setReproduction] = useState('');
  const [columnId, setColumnId] = useState('');
  const [savingDiagnostic, setSavingDiagnostic] = useState(false);
  const [bugRecording, setBugRecording] = useState(false);
  const [bugBusy, setBugBusy] = useState(false);
  const [bugDraft, setBugDraft] = useState<BugCaptureDraft | null>(null);
  const [bugCardId, setBugCardId] = useState('');
  const [bugTargetKind, setBugTargetKind] = useState<BugReplayTarget['kind']>('test-id');
  const [bugTargetValue, setBugTargetValue] = useState('');
  const [bugExpected, setBugExpected] = useState<'visible' | 'hidden'>('visible');
  const viewport = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const syncBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    void window.studio.browserSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch((reason: unknown) => setError(messageOf(reason)));
  }, []);

  useEffect(() => {
    if (!window.studio) return;
    let mounted = true;
    const unsubscribe = window.studio.onBrowserState((next) => { if (mounted) setState(next); });
    void window.studio.browserState().then((next) => { if (mounted) setState(next); }).catch((reason: unknown) => {
      if (mounted) setError(messageOf(reason));
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!editing.current) setAddress(state.url);
  }, [state.url, state.activeTabId]);

  useEffect(() => {
    setSelectedDiagnosticId((old) => state.diagnostics.some((item) => item.id === old) ? old : state.diagnostics[0]?.id ?? null);
  }, [state.diagnostics]);

  useEffect(() => {
    setColumnId((old) => snapshot?.columns.some((item) => item.id === old) ? old : snapshot?.columns.find((item) => item.name.trim().toLowerCase() === 'to do')?.id ?? snapshot?.columns[0]?.id ?? '');
  }, [snapshot?.project.id, snapshot?.columns]);

  useEffect(() => {
    setBugDraft(null); setBugRecording(false); setBugCardId('');
    void window.studio?.discardBugCapture().catch(() => undefined);
  }, [snapshot?.project.id]);

  useEffect(() => {
    if (!window.studio) return;
    if (!active) {
      setBugRecording(false);
      void window.studio.browserSetVisible(false).catch(() => undefined);
      return;
    }
    const element = viewport.current;
    if (!element) return;
    let scheduled = 0;
    const updateBounds = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => {
        syncBounds();
      });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    updateBounds();
    void window.studio.browserSetVisible(true).catch((reason: unknown) => setError(messageOf(reason)));
    return () => {
      cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
      void window.studio.browserSetVisible(false).catch(() => undefined);
    };
  }, [active, syncBounds]);

  async function navigate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBugRecording(false);
    setError('');
    setNotice('');
    try { setState(await window.studio.browserNavigate(address)); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function command(action: () => Promise<BrowserState>) {
    setBugRecording(false);
    setError('');
    setNotice('');
    try { setState(await action()); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function capture() {
    setError('');
    setNotice('');
    try {
      const result = await window.studio.browserCapture();
      setNotice(`Screenshot (${result.width} × ${result.height}) in die Zwischenablage kopiert.`);
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function openExternal() {
    setError('');
    setNotice('');
    try {
      await window.studio.browserOpenExternal();
      setNotice('Seite im Standardbrowser geöffnet.');
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function createDiagnosticCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !selectedDiagnosticId || !columnId || savingDiagnostic) return;
    setError('');
    setNotice('');
    setSavingDiagnostic(true);
    try {
      const card = await window.studio.browserCreateDiagnosticCard({ projectId: snapshot.project.id, columnId, diagnosticId: selectedDiagnosticId, reproduction });
      setNotice('Karte angelegt. Ein Agent wurde dadurch nicht gestartet.');
      await onOpenCard?.(card.id);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setSavingDiagnostic(false); }
  }

  async function toggleBugRecording() {
    if (!snapshot || bugBusy) return;
    setBugBusy(true); setError(''); setNotice('');
    try {
      if (bugRecording) {
        const draft = await window.studio.stopBugCapture();
        setBugDraft(draft); setBugRecording(false);
        setNotice(`${draft.actions.length} Schritte aufgenommen. Prüfe sie und lege die Erwartung fest.`);
      } else {
        await window.studio.startBugCapture(snapshot.project.id);
        setBugDraft(null); setBugRecording(true);
        setNotice('Aufnahme läuft. Bediene die lokale Vorschau und stoppe dann die Aufnahme.');
      }
    } catch (reason) { setBugRecording(false); setError(messageOf(reason)); }
    finally { setBugBusy(false); }
  }

  async function saveBugRecording(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bugDraft || !bugCardId || bugBusy) return;
    setBugBusy(true); setError(''); setNotice('');
    try {
      const scenario = await window.studio.saveBugScenario({ token: bugDraft.token, cardId: bugCardId, actions: bugDraft.actions,
        expectation: { target: { kind: bugTargetKind, value: bugTargetValue.trim() }, state: bugExpected } });
      setBugDraft(null);
      setNotice('Ablauf an der Karte gespeichert. Kein Test und kein Agent wurde automatisch gestartet.');
      await onOpenCard?.(scenario.cardId);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBugBusy(false); }
  }

  async function markBugResize() {
    setError(''); setNotice('');
    try { await window.studio.markBugResize(); setNotice('Die aktuelle Vorschaugröße wurde als Schritt notiert.'); }
    catch (reason) { setError(messageOf(reason)); }
  }

  return <section className="browser-page" aria-label="Browser">
    <div className="browser-tabbar" role="tablist" aria-label="Browser-Tabs">
      {state.tabs.map((tab, index) => <div className={tab.id === state.activeTabId ? 'browser-tab active' : 'browser-tab'} key={tab.id}>
        <button type="button" role="tab" aria-selected={tab.id === state.activeTabId} aria-label={`${tab.title || tab.url || `Neuer Tab ${index + 1}`} auswählen`} className="browser-tab-select" onClick={() => void command(() => window.studio.browserSelectTab(tab.id))}>
          <Globe2 size={14} aria-hidden="true" /><span>{tab.title || tab.url || 'Neuer Tab'}</span>{tab.loading ? <RotateCw size={12} className="spin" aria-label="Lädt" /> : null}
        </button>
        <button type="button" className="browser-tab-close" title="Tab schließen" aria-label={`${tab.title || tab.url || `Tab ${index + 1}`} schließen`} onClick={() => void command(() => window.studio.browserCloseTab(tab.id))}><X size={13} /></button>
      </div>)}
      <button type="button" className="browser-tab-add" aria-label="Neuer Tab" title="Neuer Tab" onClick={() => void command(() => window.studio.browserNewTab())}><Plus size={17} /></button>
    </div>
    <div className="browser-toolbar">
      <div className="browser-nav-buttons">
        <button type="button" className="icon-button" aria-label="Zurück" title="Zurück" disabled={!state.canGoBack} onClick={() => void command(() => window.studio.browserBack())}><ArrowLeft size={17} /></button>
        <button type="button" className="icon-button" aria-label="Vorwärts" title="Vorwärts" disabled={!state.canGoForward} onClick={() => void command(() => window.studio.browserForward())}><ArrowRight size={17} /></button>
        <button type="button" className="icon-button" aria-label="Neu laden" title="Neu laden" disabled={!state.url} onClick={() => void command(() => window.studio.browserReload())}><RotateCw size={17} className={state.loading ? 'spin' : undefined} /></button>
        <button type="button" className="icon-button" aria-label="Screenshot in Zwischenablage kopieren" title="Sichtbaren Tab als Screenshot kopieren" disabled={!active || !state.url || state.loading} onClick={() => void capture()}><Camera size={17} /></button>
        <button type="button" className="icon-button" aria-label="Im Standardbrowser öffnen" title="Seite im Standardbrowser öffnen" disabled={!active || !state.url || state.loading} onClick={() => void openExternal()}><ExternalLink size={17} /></button>
      </div>
      <form className="browser-address" onSubmit={(event) => void navigate(event)}>
        <Globe2 size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="browser-url">Webadresse</label>
        <input id="browser-url" type="text" inputMode="url" autoComplete="url" spellCheck={false} value={address} onChange={(event) => setAddress(event.target.value)} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} placeholder="https://example.com" />
        <button type="submit" className="secondary-button">Öffnen</button>
      </form>
    </div>
    {error || state.error ? <div className="browser-error" role="alert">{error || state.error}</div> : null}
    {notice ? <div className="browser-notice" role="status">{notice}</div> : null}
    <details className="browser-bug-recording" onToggle={() => requestAnimationFrame(syncBounds)}>
      <summary>Fehlerablauf aufnehmen</summary>
      <p>Nur lokale Vorschauen. Die Aufnahme merkt sich höchstens fünf echte Klicks auf stabile <code>data-testid</code>- oder ID-Elemente. Nach einer Fensteränderung kannst du die neue Größe ausdrücklich als Schritt markieren. Eingaben, Seitentext und Cookies werden nicht übernommen.</p>
      <button className="secondary-button small" type="button" disabled={!active || !snapshot || !state.url || bugBusy} onClick={() => void toggleBugRecording()}>{bugBusy ? 'Bitte warten…' : bugRecording ? 'Aufnahme stoppen' : 'Aufnahme starten'}</button>
      {bugRecording ? <button className="text-button" type="button" disabled={bugBusy} onClick={() => void markBugResize()}>Aktuelle Größe als Schritt</button> : null}
      {bugDraft ? <form onSubmit={(event) => void saveBugRecording(event)}>
        <p className="browser-bug-source">{bugDraft.url} · Startgröße {bugDraft.width} × {bugDraft.height} px</p>
        <ol>{bugDraft.actions.map((step, index) => <li key={`${index}-${step.kind}`}><span>{step.kind === 'click' ? `Klick auf ${step.target.kind === 'test-id' ? 'data-testid' : 'ID'} „${step.target.value}“` : `Fenster ${step.width} × ${step.height} px`}</span><button className="text-button" type="button" disabled={bugBusy} onClick={() => setBugDraft((current) => current ? { ...current, actions: current.actions.filter((_item, at) => at !== index) } : null)}>Entfernen</button></li>)}</ol>
        <label>Zu dieser Karte speichern<select value={bugCardId} required disabled={bugBusy} onChange={(event) => setBugCardId(event.target.value)}><option value="">Karte wählen</option>{snapshot?.cards.filter((card) => !card.archivedAt).map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label>
        <div className="browser-bug-expectation"><label>Element<select value={bugTargetKind} disabled={bugBusy} onChange={(event) => setBugTargetKind(event.target.value as BugReplayTarget['kind'])}><option value="test-id">data-testid</option><option value="id">ID</option></select></label><label>Bezeichner<input value={bugTargetValue} required maxLength={80} disabled={bugBusy} onChange={(event) => setBugTargetValue(event.target.value)} placeholder="filter-button" /></label><label>Erwartung<select value={bugExpected} disabled={bugBusy} onChange={(event) => setBugExpected(event.target.value as 'visible' | 'hidden')}><option value="visible">bleibt sichtbar</option><option value="hidden">ist verborgen</option></select></label></div>
        <button className="secondary-button" type="submit" disabled={bugBusy || !bugCardId || !bugTargetValue.trim() || !bugDraft.actions.length}>An Karte speichern</button>
      </form> : null}
      {!snapshot ? <small>Wähle zuerst ein Projekt.</small> : null}
    </details>
    {state.diagnostics.length ? <BrowserDiagnostics diagnostics={state.diagnostics} selectedId={selectedDiagnosticId} snapshot={snapshot} columnId={columnId} reproduction={reproduction} saving={savingDiagnostic} onSelect={setSelectedDiagnosticId} onColumn={setColumnId} onReproduction={setReproduction} onCreate={(event) => void createDiagnosticCard(event)} onToggle={() => requestAnimationFrame(syncBounds)} /> : null}
    <div className="browser-viewport" ref={viewport}>
      {!state.url ? <div className="browser-empty"><Globe2 size={30} /><h2>Webvorschau</h2><p>Öffne hier eine Seite von Hand. Kartenagenten erhalten keinen Zugriff auf diese Tabs. Ihre lesende lokale Browserprüfung stellst du unter Einstellungen ein.</p>{onOpenSettings ? <button className="text-button" type="button" onClick={onOpenSettings}>Browser-Einstellungen öffnen</button> : null}</div> : null}
    </div>
  </section>;
}

export function BrowserDiagnostics({ diagnostics, selectedId, snapshot, columnId, reproduction, saving, onSelect, onColumn, onReproduction, onCreate, onToggle }: {
  diagnostics: BrowserDiagnostic[]; selectedId: string | null; snapshot: ProjectSnapshot | null; columnId: string; reproduction: string; saving: boolean;
  onSelect: (id: string) => void; onColumn: (id: string) => void; onReproduction: (value: string) => void; onCreate: (event: React.FormEvent<HTMLFormElement>) => void; onToggle?: () => void;
}) {
  return <details className="browser-diagnostics" onToggle={onToggle}><summary>{diagnostics.length} Fehler im lokalen Dev-Server erfasst</summary>
      <p>Nur Konsolenfehler und Ladefehler von localhost werden erfasst. Der Verlauf bleibt bis zum Schließen des Tabs oder App-Neustart im Arbeitsspeicher. Eine Karte wird erst auf deinen Klick gespeichert.</p>
      <form onSubmit={onCreate}>
        <label>Fehler auswählen<select value={selectedId ?? ''} onChange={(event) => onSelect(event.target.value)}>{diagnostics.map((item) => <option key={item.id} value={item.id}>{item.kind === 'console' ? 'Konsole' : 'Laden'} · {item.message.slice(0, 100)}</option>)}</select></label>
        {diagnostics.filter((item) => item.id === selectedId).map((item) => <div className="browser-diagnostic-source" key={item.id}><strong>{item.message}</strong><small>{item.pageUrl}{item.sourceUrl ? ` · ${item.sourceUrl}${item.line ? `:${item.line}` : ''}` : ''}</small></div>)}
        <label>Reproduktionsschritte<textarea rows={2} maxLength={2_000} value={reproduction} onChange={(event) => onReproduction(event.target.value)} placeholder="Was hast du vor dem Fehler getan?" /></label>
        <div className="browser-diagnostic-action"><label>Spalte<select value={columnId} disabled={!snapshot || saving} onChange={(event) => onColumn(event.target.value)}>{snapshot?.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="submit" disabled={!snapshot || !columnId || saving}>{saving ? 'Speichere…' : 'Als Karte anlegen'}</button></div>
        {!snapshot ? <small>Wähle zuerst ein Projekt, um eine Karte anzulegen.</small> : null}
      </form>
    </details>;
}
