import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentCandidate, ComponentCatalog } from '../../shared/component-catalog';
import type { ComponentRecommendationResult } from '../../shared/component-recommendations';
import type { CardComponentChoiceState, ProjectComponentLibrary } from '../../shared/card-component-choice';
import './card-component-choice.css';

interface Props { cardId: string; projectId: string; archived: boolean }
const reasonText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

function VariantSnapshot({ cardId, variantId, label }: { cardId: string; variantId: string; label: string }) {
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setImage(''); setError(''); setBusy(false); }, [cardId, variantId]);
  async function open() {
    if (image) { setImage(''); return; }
    setBusy(true); setError('');
    try { setImage(await window.studio.cardComponentVariantScreenshot({ cardId, variantId })); }
    catch (reason) { setError(reasonText(reason)); }
    finally { setBusy(false); }
  }
  return <div className="card-component-choice__snapshot"><button type="button" className="text-button" disabled={busy} onClick={() => void open()}>{busy ? 'Lädt…' : image ? 'Bild schließen' : 'Gerenderte Variante ansehen'}</button>{error ? <small role="alert">{error}</small> : null}{image ? <img src={image} alt={`Momentaufnahme: ${label}`} /> : null}</div>;
}

export function ComponentRecommendationList({ result, disabled, selectedKeys, onInspect }: {
  result: ComponentRecommendationResult;
  disabled: boolean;
  selectedKeys: string[];
  onInspect: (candidate: ComponentCandidate) => void;
}) {
  return <section className="card-component-choice__suggestions" aria-label="Komponentenvorschläge">
    <h4>Worttreffer aus dieser Karte</h4>
    <p>Exportnamen und Pfade wurden mit Titel und Beschreibung verglichen. Ein Treffer belegt keine fachliche Eignung; bitte Quelle und Verwendung selbst prüfen.</p>
    <p className="card-component-choice__meta">{result.scannedFiles} Dateien geprüft{result.partial ? ' · Inventur unvollständig' : ''}. {result.notes.join(' ')}</p>
    {result.recommendations.length ? <ul>{result.recommendations.map(({ candidate, evidence }) => <li key={`${candidate.path}:${candidate.name}:${candidate.line}`}>
      <div><strong>{candidate.name}</strong><code>{candidate.path}:{candidate.line} · SHA-256 {candidate.sourceFingerprint.slice(0, 12)}</code>
        <small>{evidence.map((item) => `${item.cardField === 'title' ? 'Titel' : 'Beschreibung'} „${item.cardTerm}“ → ${item.sourceField === 'export' ? 'Export' : 'Pfad'} „${item.sourceTerm}“${item.rule === 'fixed-ui-term' ? ' (feste UI-Wortregel)' : ''}`).join(' · ')}</small></div>
      <button type="button" className="text-button" disabled={disabled || selectedKeys.includes(`${candidate.path}:${candidate.name}`)} onClick={() => onInspect(candidate)}>Prüfen</button>
    </li>)}</ul> : <p>Keine ausreichend eindeutigen Worttreffer. Du kannst alle Quellen durchsuchen.</p>}
  </section>;
}

export function ProjectComponentLibraryList({ library, disabled, selectedKeys, onInspect }: {
  library: ProjectComponentLibrary;
  disabled: boolean;
  selectedKeys: string[];
  onInspect: (candidate: ComponentCandidate) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('de-DE');
  const visible = library.entries.filter((entry) =>
    `${entry.name} ${entry.path} ${entry.sourceCardTitle} ${entry.purpose}`.toLocaleLowerCase('de-DE').includes(needle));
  return <section className="card-component-choice__library" aria-label="Im Projekt verwendete Komponenten">
    <h4>Im Projekt verwendet</h4>
    {library.entries.length ? <label>Filtern<input type="search" maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Komponente, Datei oder Karte" /></label> : null}
    {visible.length ? <ul>{visible.map((entry) => <li key={`${entry.path}:${entry.name}:${entry.sourceFingerprint}`}>
      <div className="card-component-choice__library-source"><strong>{entry.name}</strong><code>{entry.path}:{entry.line} · SHA-256 {entry.sourceFingerprint.slice(0, 12)}</code>
        <small>Aus „{entry.sourceCardTitle}“ · {entry.usedByCards} {entry.usedByCards === 1 ? 'Karte' : 'Karten'} · {entry.currentCandidate ? 'Quelle aktuell' : 'Quelle geändert oder nicht im Git-Scan'}</small>
        <small>Letzter Verwendungshinweis: {entry.purpose}</small></div>
      {entry.variants.length ? <div className="card-component-choice__library-variants">{entry.variants.map((variant) => <div key={variant.id}><small>{variant.label} · Bild aus „{variant.sourceCardTitle}“ · {new Date(variant.capturedAt).toLocaleString('de-DE')}</small>
        <VariantSnapshot cardId={variant.sourceCardId} variantId={variant.id} label={variant.label} /></div>)}</div> : <small>Keine gerenderte Beispielroute gespeichert.</small>}
      <button type="button" className="text-button" disabled={disabled || !entry.currentCandidate || selectedKeys.includes(`${entry.path}:${entry.name}`)} onClick={() => { if (entry.currentCandidate) onInspect(entry.currentCandidate); }}>Für diese Karte prüfen</button>
    </li>)}</ul> : <p>{library.entries.length ? 'Keine passenden Projektbeispiele.' : 'Für dieses Projekt wurden noch keine Komponenten bewusst an Karten gebunden.'}</p>}
    {library.limited || library.catalogPartial ? <small>Die Liste oder Git-Inventur ist begrenzt. Weitere Quellen können fehlen.</small> : null}
  </section>;
}

export function CardComponentChoicePanel({ cardId, projectId, archived }: Props) {
  const [state, setState] = useState<CardComponentChoiceState | null>(null);
  const [catalog, setCatalog] = useState<ComponentCatalog | null>(null);
  const [library, setLibrary] = useState<ProjectComponentLibrary | null>(null);
  const [recommendations, setRecommendations] = useState<ComponentRecommendationResult | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ComponentCandidate | null>(null);
  const [purpose, setPurpose] = useState('');
  const [variantChoiceId, setVariantChoiceId] = useState<string | null>(null);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantUrl, setVariantUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    let live = true;
    setState(null); setCatalog(null); setLibrary(null); setRecommendations(null); setChosen(null); setPurpose(''); setQuery(''); setError(''); setVariantChoiceId(null); setVariantLabel(''); setVariantUrl(''); setBusy(false);
    void window.studio.cardComponentChoiceState(cardId).then((result) => { if (live && generation.current === current) setState(result); })
      .catch((reason: unknown) => { if (live && generation.current === current) setError(reasonText(reason)); });
    return () => { live = false; generation.current++; };
  }, [cardId, projectId]);

  async function search() {
    const current = generation.current;
    setBusy(true); setError(''); setChosen(null);
    try { const result = await window.studio.componentCatalog(projectId); if (generation.current === current) setCatalog(result); }
    catch (reason) { if (generation.current === current) { setCatalog(null); setError(reasonText(reason)); } }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function loadLibrary() {
    const current = generation.current;
    setBusy(true); setError(''); setChosen(null);
    try { const result = await window.studio.projectComponentLibrary(projectId); if (generation.current === current) setLibrary(result); }
    catch (reason) { if (generation.current === current) { setLibrary(null); setError(reasonText(reason)); } }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function suggest() {
    if (!state) return;
    const current = generation.current;
    setBusy(true); setError(''); setChosen(null); setRecommendations(null);
    try {
      const result = await window.studio.componentRecommendations(cardId);
      if (generation.current !== current) return;
      if (result.projectId !== projectId || result.cardId !== cardId || result.cardRevision !== state.contentRevision) {
        throw new Error('Karte wurde geändert. Vorschläge erneut laden.');
      }
      setRecommendations(result);
    } catch (reason) {
      if (generation.current === current) {
        setError(reasonText(reason));
        try { const latest = await window.studio.cardComponentChoiceState(cardId); if (generation.current === current) setState(latest); }
        catch { /* The original error remains visible. */ }
      }
    } finally { if (generation.current === current) setBusy(false); }
  }

  async function add() {
    if (!chosen || !state) return;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const result = await window.studio.addCardComponentChoice({ cardId, expectedContentRevision: state.contentRevision,
        name: chosen.name, path: chosen.path, line: chosen.line, sourceFingerprint: chosen.sourceFingerprint, purpose });
      if (generation.current === current) { setState(result); setLibrary(null); setRecommendations(null); setChosen(null); setPurpose(''); }
    } catch (reason) {
      if (generation.current === current) { setError(reasonText(reason)); const latest = await window.studio.cardComponentChoiceState(cardId); if (generation.current === current) setState(latest); }
    } finally { if (generation.current === current) setBusy(false); }
  }

  async function remove(choiceId: string) {
    if (!state) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { const result = await window.studio.removeCardComponentChoice({ cardId, choiceId, expectedContentRevision: state.contentRevision }); if (generation.current === current) { setState(result); setRecommendations(null); } }
    catch (reason) { if (generation.current === current) { setError(reasonText(reason)); const latest = await window.studio.cardComponentChoiceState(cardId); if (generation.current === current) setState(latest); } }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function captureVariant() {
    if (!state || !variantChoiceId || !variantLabel.trim() || !variantUrl.trim() || busy) return;
    const current = generation.current;
    const expectedContentRevision = state.contentRevision;
    setBusy(true); setError('');
    try {
      const report = await window.studio.runCardQa({ cardId, url: variantUrl, viewport: 'desktop' });
      if (generation.current !== current) return;
      if (report.status !== 'passed' || !report.screenshotAvailable) throw new Error(`Die lokale Route lieferte keine erfolgreiche Bildvorschau (${report.status}). Prüfe den QA-Bericht und versuche es erneut.`);
      const result = await window.studio.addCardComponentVariant({ cardId, choiceId: variantChoiceId, expectedContentRevision, reportId: report.id, label: variantLabel });
      if (generation.current === current) { setState(result); setVariantChoiceId(null); setVariantLabel(''); setVariantUrl(''); }
    } catch (reason) {
      if (generation.current === current) { setError(reasonText(reason)); const latest = await window.studio.cardComponentChoiceState(cardId); if (generation.current === current) setState(latest); }
    } finally { if (generation.current === current) setBusy(false); }
  }

  async function removeVariant(variantId: string) {
    if (!state || busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { const result = await window.studio.removeCardComponentVariant({ cardId, variantId, expectedContentRevision: state.contentRevision }); if (generation.current === current) setState(result); }
    catch (reason) { if (generation.current === current) { setError(reasonText(reason)); const latest = await window.studio.cardComponentChoiceState(cardId); if (generation.current === current) setState(latest); } }
    finally { if (generation.current === current) setBusy(false); }
  }

  const candidates = useMemo(() => catalog?.candidates.filter((candidate) =>
    `${candidate.name} ${candidate.path}`.toLocaleLowerCase('de-DE').includes(query.trim().toLocaleLowerCase('de-DE'))) ?? [], [catalog, query]);
  const selected = state?.choices ?? [];
  return <details className="card-component-choice" aria-label="Komponentenreferenzen">
    <summary>Komponentenreferenzen <span>{selected.length ? `${selected.length} gewählt` : 'aus dem Projekt wählen'}</span></summary>
    <div className="card-component-choice__body">
      <p>Wähle vorhandene TSX-/JSX-Exporte für diesen Auftrag. Projektcode wird für diese Auswahl nicht ausgeführt. Für echte Variantenbilder muss deine laufende Projekt-App eine lokale Beispielroute bereitstellen. Branchloom lädt diese Route in der isolierten Browser-QA.</p>
      {error ? <p role="alert" className="inline-error">{error}</p> : null}
      {selected.length ? <ul className="card-component-choice__selected">{selected.map((choice) => <li key={choice.id}>
        <div><strong>{choice.name}</strong><code>{choice.path}:{choice.line}</code><small>{choice.purpose || 'Ohne Verwendungshinweis'} · {choice.current ? `Quelle geprüft · ${choice.sourceFingerprint.slice(0, 12)}` : 'Quelle geändert oder nicht verfügbar · erneut auswählen'}</small>
          {choice.variants.length ? <ul className="card-component-choice__variants">{choice.variants.map((variant) => <li key={variant.id}><div><strong>{variant.label}</strong><small>Lokale Route: {variant.previewUrl}</small><small>QA {variant.reportId.slice(0, 8)} · {new Date(variant.capturedAt).toLocaleString('de-DE')} · Quelle {variant.sourceFingerprint.slice(0, 12)}</small><VariantSnapshot cardId={cardId} variantId={variant.id} label={variant.label} /></div><button type="button" className="text-button" disabled={busy || archived} onClick={() => void removeVariant(variant.id)}>Variante lösen</button></li>)}</ul> : null}
          {choice.variants.length < 2 ? <button type="button" className="text-button" disabled={busy || archived || !choice.current} onClick={() => { setVariantChoiceId(choice.id); setVariantLabel(''); setVariantUrl(''); setError(''); }}>Beispielroute als Variante erfassen</button> : null}
        </div>
        <button type="button" className="text-button" disabled={busy || archived} onClick={() => void remove(choice.id)}>Lösen</button>
      </li>)}</ul> : <p className="card-component-choice__empty">Noch keine Komponente verbunden.</p>}
      {variantChoiceId ? <form className="card-component-choice__variant-form" onSubmit={(event) => { event.preventDefault(); void captureVariant(); }}><h4>Variante aus der laufenden App</h4><p>Die Route muss die gewünschte Variante bereits rendern. Nutze für jede Variante einen eigenen Pfad; Query-Werte werden im Beleg aus Datenschutzgründen nicht gespeichert. Die Zuordnung zum Export bestätigst du selbst.</p><label>Variantenname<input maxLength={60} minLength={2} required value={variantLabel} onChange={(event) => setVariantLabel(event.target.value)} placeholder="Kompakter Dialog" /></label><label>Lokale Beispielroute<input type="url" maxLength={2048} required value={variantUrl} onChange={(event) => setVariantUrl(event.target.value)} placeholder="http://127.0.0.1:5173/stories/dialog/compact" /></label><div><button type="submit" className="secondary-button" disabled={busy || archived || variantLabel.trim().length < 2 || !variantUrl.trim()}>{busy ? 'Prüfe Route…' : 'Route prüfen und Variante sichern'}</button><button type="button" className="text-button" disabled={busy} onClick={() => setVariantChoiceId(null)}>Abbrechen</button></div></form> : null}
      <div className="card-component-choice__actions"><button type="button" className="secondary-button" disabled={busy || archived || !state || selected.length >= 6} onClick={() => void suggest()}>{busy ? 'Prüfe…' : 'Aus Kartentext vorschlagen'}</button><button type="button" className="text-button" disabled={busy || archived || selected.length >= 6} onClick={() => void loadLibrary()}>{library ? 'Projektbeispiele aktualisieren' : 'Im Projekt verwendet'}</button><button type="button" className="text-button" disabled={busy || archived || selected.length >= 6} onClick={() => void search()}>{catalog ? 'Quellen erneut suchen' : 'Alle Quellen durchsuchen'}</button></div>
      {library ? <ProjectComponentLibraryList library={library} disabled={busy || archived || selected.length >= 6}
        selectedKeys={selected.map((item) => `${item.path}:${item.name}`)} onInspect={(candidate) => { setChosen(candidate); setPurpose(''); }} /> : null}
      {recommendations ? <ComponentRecommendationList result={recommendations} disabled={busy || archived || selected.length >= 6}
        selectedKeys={selected.map((item) => `${item.path}:${item.name}`)} onInspect={(candidate) => { setChosen(candidate); setPurpose(''); }} /> : null}
      {catalog ? <><p className="card-component-choice__meta">{catalog.candidates.length} Kandidaten aus {catalog.scannedFiles} Dateien{catalog.partial ? ' · Inventur unvollständig' : ''}</p>
        {catalog.notes.length ? <p className="card-component-choice__meta">{catalog.notes.join(' ')}</p> : null}
        <label className="card-component-choice__filter">Filtern<input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder Pfad" /></label>
        <ul className="card-component-choice__candidates">{candidates.slice(0, 40).map((candidate) => <li key={`${candidate.path}:${candidate.name}:${candidate.line}`}>
          <button type="button" disabled={busy || archived || selected.some((item) => item.path === candidate.path && item.name === candidate.name)} onClick={() => { setChosen(candidate); setPurpose(''); }} aria-pressed={chosen?.path === candidate.path && chosen.name === candidate.name}>
            <strong>{candidate.name}</strong><code>{candidate.path}:{candidate.line}</code>
          </button>
        </li>)}</ul>
        {candidates.length > 40 ? <p className="card-component-choice__meta">Nur 40 Treffer sichtbar. Filtere nach Name oder Pfad.</p> : null}
      </> : null}
      {chosen ? <div className="card-component-choice__confirm"><p><strong>{chosen.name}</strong> aus <code>{chosen.path}:{chosen.line}</code></p><label>Verwendungshinweis<input maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Zum Beispiel: Dialog für Einstellungen" /></label><button type="button" disabled={busy || archived || !state || purpose.trim().length < 3} onClick={() => void add()}>Referenz übernehmen</button></div> : null}
      <p className="card-component-choice__meta">Die Inventur belegt Exportnamen und Dateien. Variantenbilder stammen aus ausdrücklich geprüften lokalen Routen; die Zuordnung zwischen Route und Export ist eine manuelle Angabe, keine Codeanalyse.</p>
    </div>
  </details>;
}
