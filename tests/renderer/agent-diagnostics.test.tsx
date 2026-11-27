import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentCapabilityRows, AgentView, DiagnosticStatus, agentProfileSummary, diagnosticHint } from '../../src/renderer/components/AgentView';
import type { AgentDetection, AgentPreset, ProjectSnapshot } from '../../src/shared/types';

const base: AgentDetection = { kind: 'codex', command: 'codex', available: false, version: null, status: 'missing' };

describe('agent diagnostic messages', () => {
  it('shows the project-scoped metadata permission as initially unavailable until loaded', () => {
    const snapshot = {
      project: { id: 'p', name: 'Synthetic', path: '/synthetic', createdAt: '2026-11-24T00:00:00.000Z' },
      columns: [], cards: [], agents: [], sessions: [], workflows: [], notes: [],
      queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
    } satisfies ProjectSnapshot;
    const html = renderToStaticMarkup(<AgentView snapshot={snapshot} mutate={async () => null} />);
    expect(html).toContain('Agenten dürfen ändern');
    expect(html).toContain('Noch keine Agentenänderungen');
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
    expect(html).toContain('Browser-Einstellungen öffnen');
  });
  it('distinguishes missing CLI, timeout and verified version from login', () => {
    expect(diagnosticHint(base)).toContain('nicht gefunden');
    expect(diagnosticHint({ ...base, status: 'timeout' })).toContain('8 Sekunden');
    expect(diagnosticHint({ ...base, kind: 'antigravity', status: 'timeout' })).toContain('20 Sekunden');
    expect(diagnosticHint({ ...base, status: 'ready', available: true })).toContain('Anmeldung');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, status: 'timeout' }} />)).toContain('Zeitlimit');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, status: 'found', available: true }} />)).toContain('CLI gefunden');
  });

  it('keeps project activation separate from local CLI readiness', () => {
    const agent: AgentPreset = { id: 'a', name: 'Claude fixture', kind: 'claude', command: 'claude', args: [], model: null, enabled: true };
    expect(agentProfileSummary(agent, { ...base, kind: 'claude', profileId: 'a' })).toContain('nicht startbereit');
    expect(agentProfileSummary(agent, { ...base, kind: 'claude', profileId: 'a', status: 'ready', available: true })).toContain('Anmeldung und Modellzugang ungeprüft');
    expect(agentProfileSummary({ ...agent, enabled: false }, { ...base, kind: 'claude', profileId: 'a' })).toBe('Im Projekt deaktiviert');
    expect(renderToStaticMarkup(<DiagnosticStatus item={{ ...base, kind: 'claude' }} />)).toContain('CLI fehlt');
  });

  it('states what a session proved without implying model access or a restored conversation', () => {
    const agent: AgentPreset = { id: 'a', name: 'Codex fixture', kind: 'codex', command: 'codex', args: [], model: null, enabled: true };
    const html = renderToStaticMarkup(<AgentCapabilityRows agent={agent} evidence={[
      { agentId: 'a', capability: 'start', sessionId: 's1', observedAt: '2026-11-24T12:00:00.000Z' },
      { agentId: 'a', capability: 'resume', sessionId: 's2', observedAt: '2026-11-24T12:01:00.000Z' },
    ]} />);
    expect(html).toContain('Lokaler PTY-Prozess gestartet');
    expect(html).toContain('Noch keine manuelle Eingabe belegt');
    expect(html).toContain('Codex-Resume-Aufruf gestartet');
    expect(html).not.toContain('Gespräch wiederhergestellt');
    const other = renderToStaticMarkup(<AgentCapabilityRows agent={{ ...agent, kind: 'gemini' }} evidence={[]} />);
    expect(other).toContain('Für diesen Adapter derzeit nicht implementiert');
  });
});
