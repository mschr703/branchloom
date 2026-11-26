import { useEffect, useRef, useState } from 'react';
import type { ProjectSnapshot, ProjectQueue } from '../../shared/types';
import type { ProjectCodexWorkflowAccess } from '../../shared/project-agent-rights';
import type { IntegrationPolicy } from '../../shared/integration-queue';
import type { Card } from '../../shared/types';
import type { Mutate } from './shared';
import './queue-start-preview.css';

interface StartReview {
  project: { id: string; name: string; path: string };
  route: { id: string; name: string; steps: string[]; usesCodex: boolean };
  candidates: Array<{ id: string; title: string }>;
  codexMode: ProjectCodexWorkflowAccess['mode'];
  integrationMode: IntegrationPolicy['mode'];
  continueBlocked: boolean;
  autoResumeIdle: boolean;
  queueState: ProjectQueue['state'];
}

export function queueStartReview(snapshot: ProjectSnapshot, templateId: string, candidates: Card[],
  codex: ProjectCodexWorkflowAccess, integration: IntegrationPolicy): StartReview {
  const route = snapshot.workflows.find((item) => item.id === templateId);
  if (!route) throw new Error('Die gewählte Route existiert nicht mehr. Wähle eine aktuelle Vorlage.');
  return {
    project: { id: snapshot.project.id, name: snapshot.project.name, path: snapshot.project.path },
    route: { id: route.id, name: route.name, usesCodex: route.steps.some((step) => snapshot.agents.find((item) => item.id === step.agentId)?.kind === 'codex'),
      steps: route.steps.map((step) => {
        const column = snapshot.columns.find((item) => item.id === step.columnId)?.name ?? 'Entfernte Spalte';
        const agent = step.agentId ? snapshot.agents.find((item) => item.id === step.agentId)?.name ?? 'Entfernter Agent' : 'manuell';
        return `${column} · ${agent}${step.requireApproval ? ' · Freigabe' : ''}`;
      }) },
    candidates: candidates.map(({ id, title }) => ({ id, title })),
    codexMode: codex.mode, integrationMode: integration.mode,
    continueBlocked: snapshot.queue.continueBlocked === true,
    autoResumeIdle: snapshot.queue.autoResumeIdle === true,
    queueState: snapshot.queue.state,
  };
}

async function loadReview(projectId: string, templateId: string): Promise<StartReview> {
  const [snapshot, candidates, codex, integration] = await Promise.all([
    window.studio.snapshot(projectId), window.studio.queueCandidates(projectId),
    window.studio.projectCodexWorkflowAccess(projectId), window.studio.integrationPolicy(projectId),
  ]);
  return queueStartReview(snapshot, templateId, candidates, codex, integration);
}

export function QueueStartPreview({ projectId, templateId, hours, mutate, onClose }: {
  projectId: string; templateId: string; hours: number; mutate: Mutate; onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const startingRef = useRef(false);
  const [review, setReview] = useState<StartReview | null>(null);
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
    void loadReview(projectId, templateId).then(
      (value) => { if (active) setReview(value); },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { active = false; };
  }, [projectId, templateId, retry]);

  async function start() {
    if (!review || starting) return;
    startingRef.current = true;
    setStarting(true); setError('');
    try {
      const current = await loadReview(projectId, templateId);
      if (JSON.stringify(current) !== JSON.stringify(review)) {
        setReview(current);
        setError('Projekt, Route oder Einstellungen haben sich geändert. Prüfe die aktualisierte Vorschau und klicke erneut.');
        return;
      }
      if (current.queueState === 'running') throw new Error('Die Queue läuft bereits. Lade den aktuellen Projektstand.');
      const runUntil = hours ? new Date(Date.now() + hours * 60 * 60 * 1_000).toISOString() : null;
      const saved = await mutate(() => window.studio.setProjectQueue({ projectId, state: 'running', templateWorkflowId: templateId, runUntil }));
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
        </dl>
        <div className="queue-start-scope"><strong>Nächste freie Karten</strong>{review.candidates.length
          ? <ol>{review.candidates.slice(0, 5).map((card) => <li key={card.id}>{card.title}</li>)}</ol>
          : <p>Keine freie Karte vorhanden. Die Queue wartet nach dem Start auf neue To-Do-Karten.</p>}
          {review.candidates.length > 5 ? <small>Weitere Karten folgen gemäß Board-Reihenfolge und Abhängigkeiten.</small> : null}
        </div>
        <p className="queue-start-policy">{review.continueBlocked ? 'Blockierte Karten dürfen für unabhängige Aufgaben zurückgestellt werden.' : 'Bei einer blockierten Karte hält die Queue an.'} {review.autoResumeIdle ? 'Eine ruhende Queue darf nach einem beobachteten Netzwechsel weiterlaufen.' : 'Nach einem Netzverlust bleibt die Queue angehalten.'}</p>
      </> : !error ? <p role="status">Aktuellen Projektstand laden …</p> : null}
      {error ? <div className="queue-start-error"><p className="inline-error" role="alert">{error}</p>{!review ? <button type="button" className="secondary-button small" onClick={() => setRetry((value) => value + 1)}>Erneut laden</button> : null}</div> : null}
      <footer className="dialog-actions"><button type="button" className="secondary-button" disabled={starting} onClick={onClose}>Zurück</button><button type="button" className="primary-button" disabled={!review || starting} onClick={() => void start()}>{starting ? 'Prüfe…' : 'Queue starten'}</button></footer>
    </section>
  </div>;
}
