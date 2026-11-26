import { useEffect, useRef, useState } from 'react';
import type { QueueStartReview } from '../../shared/queue-start-review';
import type { Mutate } from './shared';
import './queue-start-preview.css';

const loadReview = (projectId: string, templateId: string, hours: number) => window.studio.queueStartPreview({
  projectId, templateWorkflowId: templateId, durationHours: hours as 0 | 1 | 4 | 8,
});

export function QueueStartPreview({ projectId, templateId, hours, mutate, onClose }: {
  projectId: string; templateId: string; hours: number; mutate: Mutate; onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const startingRef = useRef(false);
  const [review, setReview] = useState<QueueStartReview | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !startingRef.current) onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setReview(null); setError('');
    void loadReview(projectId, templateId, hours).then(
      (value) => { if (active) setReview(value); },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { active = false; };
  }, [projectId, templateId, hours, retry]);

  async function start() {
    if (!review || starting) return;
    startingRef.current = true;
    setStarting(true); setError('');
    try {
      const current = await loadReview(projectId, templateId, hours);
      if (JSON.stringify(current) !== JSON.stringify(review)) {
        setReview(current);
        setError('Projekt, Route oder Einstellungen haben sich geändert. Prüfe die aktualisierte Vorschau und klicke erneut.');
        return;
      }
      if (current.queueState === 'running') throw new Error('Die Queue läuft bereits. Lade den aktuellen Projektstand.');
      const saved = await mutate(() => window.studio.setProjectQueue({ projectId, state: 'running', templateWorkflowId: templateId,
        durationHours: current.durationHours, reviewToken: current.token }));
      if (saved) onClose();
      else setError('Der Start wurde nicht bestätigt. Prüfe die Fehlermeldung und versuche es erneut.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { startingRef.current = false; setStarting(false); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !starting) onClose(); }}>
    <section className="dialog queue-start-review" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="queue-start-title">
      <header className="queue-start-heading"><div><h2 id="queue-start-title" ref={headingRef} tabIndex={-1}>Projektlauf prüfen</h2><p>Erst mit „Starten“ wird eine neue Karte beansprucht.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={starting} aria-label="Schließen">×</button></header>
      {review ? <>
        <dl className="queue-start-facts">
          <div><dt>Projekt</dt><dd><strong>{review.project.name}</strong><small title={review.project.path}>{review.project.path}</small></dd></div>
          <div><dt>Route</dt><dd><strong>{review.route.name}</strong><small>{review.route.steps.join(' → ') || 'Keine Schritte konfiguriert'}</small></dd></div>
          <div><dt>Zeitraum</dt><dd>{hours ? `${hours} ${hours === 1 ? 'Stunde' : 'Stunden'} ab Start` : 'Ohne Zeitlimit'}<small>Ein schon laufender Agent wird am Ende nicht abgebrochen.</small></dd></div>
          <div><dt>Agentenrechte</dt><dd>{review.route.usesCodex ? review.codexMode === 'full' ? 'Codex: Voller CLI-Zugriff' : 'Codex: Projektmodus' : 'Kein Codex-Schritt in dieser Route'}<small>{review.route.usesCodex && review.codexMode === 'full' ? 'Der Codex-Prozess kann mit deinen Benutzerrechten auch außerhalb des Projektordners handeln.' : 'Andere installierte Agenten nutzen ihre eigenen CLI-Einstellungen.'}</small></dd></div>
          <div><dt>Folgeaktionen</dt><dd>{review.integrationMode === 'automatic' ? 'Integration nur mit vorhandenen Review- und Testbelegen' : 'Integration bleibt manuell'}<small>Branchloom startet hier weder einen Git-Push noch eine automatische Browser-QA.</small></dd></div>
          <div><dt>Test nach Karte</dt><dd>{review.autoTest ? 'Freigegebenes npm-Skript vor der nächsten Karte' : 'Kein automatischer npm-Test'}<small>{review.autoTest ? 'Fehlender sauberer Karten-Commit oder Testfehler hält die Queue an.' : 'Tests können weiter einzeln im Kartendrawer gestartet werden.'}</small></dd></div>
        </dl>
        <div className="queue-start-scope"><strong>Nächste freie Karten</strong>{review.candidates.length
          ? <ol>{review.candidates.slice(0, 5).map((card) => <li key={card.id}>{card.title}</li>)}</ol>
          : <p>Keine freie Karte vorhanden. Die Queue wartet nach dem Start auf neue To-Do-Karten.</p>}
          {review.candidates.length > 5 ? <small>Weitere Karten folgen gemäß Board-Reihenfolge und Abhängigkeiten.</small> : null}
        </div>
        <p className="queue-start-policy">{review.continueBlocked ? 'Blockierte Karten dürfen für unabhängige Aufgaben zurückgestellt werden.' : 'Bei einer blockierten Karte hält die Queue an.'} {review.autoResumeIdle ? 'Eine ruhende Queue darf nach einem beobachteten Netzwechsel weiterlaufen.' : 'Nach einem Netzverlust bleibt die Queue angehalten.'}</p>
        {review.queueState === 'paused' && review.pauseReason ? <p className="queue-start-policy" role="status">Vorheriger Halt: {review.pauseReason}</p> : null}
      </> : !error ? <p role="status">Aktuellen Projektstand laden …</p> : null}
      {error ? <div className="queue-start-error"><p className="inline-error" role="alert">{error}</p>{!review ? <button type="button" className="secondary-button small" onClick={() => setRetry((value) => value + 1)}>Erneut laden</button> : null}</div> : null}
      <footer className="dialog-actions"><button type="button" className="secondary-button" disabled={starting} onClick={onClose}>Zurück</button><button type="button" className="primary-button" disabled={!review || starting} onClick={() => void start()}>{starting ? 'Prüfe…' : 'Queue starten'}</button></footer>
    </section>
  </div>;
}
