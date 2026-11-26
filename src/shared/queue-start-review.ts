import type { Card, ProjectQueue, ProjectSnapshot } from './types';
import type { ProjectCodexWorkflowAccess } from './project-agent-rights';
import type { IntegrationPolicy } from './integration-queue';

export interface QueueStartReview {
  project: { id: string; name: string; path: string };
  route: { id: string; name: string; steps: string[]; usesCodex: boolean };
  candidates: Array<{ id: string; title: string }>;
  codexMode: ProjectCodexWorkflowAccess['mode'];
  integrationMode: IntegrationPolicy['mode'];
  continueBlocked: boolean;
  autoResumeIdle: boolean;
  autoTest: boolean;
  queueState: ProjectQueue['state'];
  pauseReason: string | null;
  durationHours: 0 | 1 | 4 | 8;
  endAt: string | null;
  token: string;
}

export function queueStartReview(snapshot: ProjectSnapshot, templateId: string, candidates: Card[],
  codex: ProjectCodexWorkflowAccess, integration: IntegrationPolicy, durationHours: 0 | 1 | 4 | 8, token = '', endAt: string | null = null): QueueStartReview {
  const route = snapshot.workflows.find((item) => item.id === templateId);
  if (!route) throw new Error('Die gewählte Route existiert nicht mehr. Wähle eine aktuelle Vorlage.');
  return {
    project: { id: snapshot.project.id, name: snapshot.project.name, path: snapshot.project.path },
    route: { id: route.id, name: route.name, usesCodex: route.steps.some((step) => snapshot.agents.find((item) => item.id === step.agentId)?.kind === 'codex'),
      steps: route.steps.map((step) => {
        const column = snapshot.columns.find((item) => item.id === step.columnId)?.name ?? 'Entfernte Spalte';
        const preset = step.agentId ? snapshot.agents.find((item) => item.id === step.agentId) : null;
        const agent = step.agentId ? preset?.name ?? 'Entfernter Agent' : 'manuell';
        const model = step.model ?? preset?.model;
        return `${column} · ${agent}${model ? ` · ${model}` : ''}${step.effort ? ` · ${step.effort}` : ''}${step.requireApproval ? ' · Freigabe' : ''}`;
      }) },
    candidates: candidates.map(({ id, title }) => ({ id, title })),
    codexMode: codex.mode, integrationMode: integration.mode,
    continueBlocked: snapshot.queue.continueBlocked === true,
    autoResumeIdle: snapshot.queue.autoResumeIdle === true,
    autoTest: snapshot.queue.autoTest === true,
    queueState: snapshot.queue.state,
    pauseReason: snapshot.queue.pauseReason,
    durationHours,
    endAt,
    token,
  };
}
