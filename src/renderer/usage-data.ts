import type { AgentPreset } from '../shared/types';
import type { UsageOrigin, UsageSession, UsageSessionPage } from '../shared/usage';

export type UsagePeriod = 7 | 30;

export interface UsageDay { key: string; label: string; runs: number }
export interface AgentUsage { id: string; name: string; runs: number; durationMs: number; active: number; failed: number }
export interface WorkflowUsage { id: string; name: string; origin: 'workflow' | 'queue'; runs: number; durationMs: number; failed: number }
export interface ProjectUsage {
  truncated: boolean;
  runs: number;
  active: number;
  failed: number;
  stopped: number;
  knownDurationMs: number;
  unknownDurationCount: number;
  agents: AgentUsage[];
  origins: Record<UsageOrigin, number>;
  workflows: WorkflowUsage[];
  days: UsageDay[];
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function usageStart(now: number, period: UsagePeriod): Date {
  const today = new Date(now);
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  first.setDate(first.getDate() - period + 1);
  return first;
}

function failed(session: UsageSession): boolean {
  return session.state === 'failed' || (session.state === 'exited' && session.exitCode !== null && session.exitCode !== 0);
}

/** Only locally stored session facts are aggregated. Terminal text is never treated as provider telemetry. */
export function projectUsage(page: UsageSessionPage, agents: AgentPreset[], now: number, period: UsagePeriod): ProjectUsage {
  const first = usageStart(now, period);
  const days: UsageDay[] = Array.from({ length: period }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return { key: localDay(date), label: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), runs: 0 };
  });
  const byDay = new Map(days.map((day) => [day.key, day]));
  const byAgent = new Map<string, AgentUsage>();
  const byWorkflow = new Map<string, WorkflowUsage>();
  const origins: Record<UsageOrigin, number> = { direct: 0, workflow: 0, queue: 0, unknown: 0 };
  let active = 0;
  let failures = 0;
  let stopped = 0;
  let knownDurationMs = 0;
  let unknownDurationCount = 0;
  let runs = 0;
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  for (const session of page.sessions) {
    const started = new Date(session.startedAt);
    const startMs = started.getTime();
    if (!Number.isFinite(startMs) || startMs < first.getTime() || startMs > now) continue;
    const day = byDay.get(localDay(started));
    if (!day) continue;
    day.runs += 1;
    runs += 1;
    const origin = session.workflowId && (session.origin === 'workflow' || session.origin === 'queue')
      ? session.origin : session.origin === 'direct' ? 'direct' : 'unknown';
    origins[origin] += 1;
    const isFailed = failed(session);
    const isActive = session.state === 'running';
    if (isFailed) failures += 1;
    if (isActive) active += 1;
    if (session.state === 'stopped') stopped += 1;
    const endMs = session.endedAt ? Date.parse(session.endedAt) : isActive ? now : NaN;
    const duration = Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;
    if (duration === null) unknownDurationCount += 1;
    else knownDurationMs += duration;
    let agent = byAgent.get(session.agentId);
    if (!agent) {
      agent = { id: session.agentId, name: agentNames.get(session.agentId) ?? 'Entfernter Agent', runs: 0, durationMs: 0, active: 0, failed: 0 };
      byAgent.set(session.agentId, agent);
    }
    agent.runs += 1;
    if (duration !== null) agent.durationMs += duration;
    if (isActive) agent.active += 1;
    if (isFailed) agent.failed += 1;
    if (session.workflowId && (origin === 'workflow' || origin === 'queue')) {
      let workflow = byWorkflow.get(session.workflowId);
      if (!workflow) {
        workflow = { id: session.workflowId, name: session.workflowName ?? 'Unbenannter Workflow', origin,
          runs: 0, durationMs: 0, failed: 0 };
        byWorkflow.set(session.workflowId, workflow);
      }
      workflow.runs += 1;
      if (duration !== null) workflow.durationMs += duration;
      if (isFailed) workflow.failed += 1;
    }
  }
  return { truncated: page.truncated, runs, active, failed: failures, stopped, knownDurationMs, unknownDurationCount,
    agents: [...byAgent.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name, 'de')),
    origins, workflows: [...byWorkflow.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name, 'de')),
    days };
}

export function formatUsageDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.floor(ms / 1000)} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
