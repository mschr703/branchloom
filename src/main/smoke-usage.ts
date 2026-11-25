import type { BrowserWindow } from 'electron';
import type { StudioStore } from './store';

/** Visible Usage acceptance with synthetic SQLite data and no provider call. */
export async function runUsageSmoke(window: BrowserWindow, store: StudioStore, root: string): Promise<void> {
  const project = store.createProject({ name: 'Usage Smoke', path: root });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const agentId = store.agents()[0]!.id;
  const card = (title: string) => store.createCard({ projectId: project.id, columnId, title });
  const direct = store.createSession({ cardId: card('Direct run').id, agentId });
  store.finishSession(direct.id, 'exited', 0);
  const flowCard = card('Workflow run');
  const flow = store.createWorkflow({ projectId: project.id, name: 'Usage route', cardIds: [flowCard.id], steps: [
    { id: 'run', columnId, agentId, requireApproval: false },
  ] });
  store.ensureWorkflowProgress(flow.id, 0, [flowCard.id]);
  const linked = store.createSession({ cardId: flowCard.id, agentId });
  store.beginWorkflowCard(flow.id, 0, flowCard.id, linked.id);
  store.finishSession(linked.id, 'exited', 0);
  const queueCard = card('Queue run');
  const queue = store.createWorkflow({ projectId: project.id, name: 'Usage queue', cardIds: [queueCard.id], steps: [
    { id: 'run', columnId, agentId, requireApproval: false },
  ] });
  store.db.prepare('INSERT INTO queue_runs (project_id, card_id, workflow_id) VALUES (?, ?, ?)').run(project.id, queueCard.id, queue.id);
  store.ensureWorkflowProgress(queue.id, 0, [queueCard.id]);
  const queued = store.createSession({ cardId: queueCard.id, agentId });
  store.beginWorkflowCard(queue.id, 0, queueCard.id, queued.id);
  store.finishSession(queued.id, 'failed', 2);
  const old = store.createSession({ cardId: card('Historical run').id, agentId });
  store.finishSession(old.id, 'stopped', null);
  store.db.prepare('DELETE FROM session_usage_origins WHERE session_id = ?').run(old.id);
  const source = store.usageSessions({ projectId: project.id, since: new Date(Date.now() - 86_400_000).toISOString() });
  if (source.sessions.length !== 4 || source.sessions.find((item) => item.id === old.id)?.origin !== 'unknown'
    || source.sessions.find((item) => item.id === queued.id)?.origin !== 'queue') throw new Error('Usage metadata does not match synthetic sources.');
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      throw new Error('Usage UI timeout: ' + label);
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project button')]
      .find((item) => item.textContent?.trim() === 'Usage Smoke'), 'project choice');
    choice.click();
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Aktivität'), 'activity navigation');
    nav.click();
    const usageTab = await wait(() => [...document.querySelectorAll('.activity-section-switch button')]
      .find((item) => item.textContent?.trim() === 'Nutzung'), 'usage tab');
    usageTab.click();
    const panel = await wait(() => document.querySelector('.usage-panel .usage-origin'), 'usage origins');
    const rows = [...panel.querySelectorAll('dl > div')].map((row) => row.textContent?.trim());
    if (!rows.includes('Projektwarteschlange1') || !rows.includes('Workflow1')
      || !rows.includes('Ohne Workflow1') || !rows.includes('Historisch ungeklärt1'))
      throw new Error('Usage source counts differ from stored run origins: ' + JSON.stringify(rows));
    const tokens = document.querySelector('.usage-telemetry')?.textContent ?? '';
    if (!tokens.includes('Kein verifizierter Wert') || document.querySelector('.usage-panel')?.textContent?.includes('0 Token'))
      throw new Error('Missing honest token and cost state.');
    const links = [...document.querySelectorAll('.usage-workflow-list button')];
    if (links.length !== 2 || !links.some((item) => item.textContent?.includes('Usage route'))
      || !links.some((item) => item.textContent?.includes('Usage queue')))
      throw new Error('Stored workflow and queue runs are not visible.');
    links[0].focus();
    if (document.activeElement !== links[0]) throw new Error('Workflow source is not keyboard focusable.');
    const queueLink = links.find((item) => item.textContent?.includes('Usage queue'));
    queueLink.click();
    await wait(() => document.getElementById('workflow-' + ${JSON.stringify(queue.id)})?.textContent?.includes('Usage queue'), 'workflow source navigation');
    return true;
  })()`);
}
