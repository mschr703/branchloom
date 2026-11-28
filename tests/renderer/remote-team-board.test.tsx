// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RemoteTeamBoardView } from '../../src/renderer/components/RemoteTeamBoardView';

vi.mock('../../src/renderer/components/TeamCardDraftEditor', () => ({
  TeamCardDraftEditor: ({ canEdit }: { canEdit: boolean }) => <p>{canEdit ? 'Editable shared draft' : 'Read-only shared draft'}</p>,
}));

const uuid = (end: string) => `00000000-0000-4000-8000-${end}`;
const projectId = uuid('000000000001');
const workspaceId = uuid('000000000002');
const columnId = uuid('000000000003');
const cardId = uuid('000000000004');
const board = { projectName: 'Synthetic app', observedAt: new Date().toISOString(), queueState: 'off', truncated: false,
  columns: [{ id: columnId, name: 'To Do', startsAgent: false }],
  cards: [{ id: cardId, columnId, title: 'Build sign-in', priority: 'none', runningSince: null, revision: 0 }] };
const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');

afterEach(() => {
  if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
  if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

function setup(canManageTask: boolean) {
  const teamBoard = vi.fn().mockResolvedValue(board);
  const teamWorkspace = vi.fn().mockResolvedValue({ member: { displayName: 'Sam', role: 'viewer' },
    projects: [{ id: projectId, name: 'Synthetic app', canEditDraft: false, canManageTask }] });
  const setTeamCardPriority = vi.fn().mockResolvedValue({ revision: 1 });
  Object.defineProperty(window, 'studio', { configurable: true, value: { teamBoard, teamWorkspace, setTeamCardPriority } });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  return { host, root, teamBoard, teamWorkspace, setTeamCardPriority,
    async cleanup() { await act(async () => { root.unmount(); }); host.remove(); } };
}

it('opens the canonical remote board but does not expose task controls to a read-only member', async () => {
  const view = setup(false);
  try {
    await act(async () => { view.root.render(<RemoteTeamBoardView workspaceId={workspaceId} projectId={projectId} projectName="Synthetic app" onTeam={() => undefined} />); });
    expect(view.teamBoard).toHaveBeenCalledWith({ workspaceId, projectId });
    expect(view.host.textContent).toContain('Build sign-in');
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.task-card')!.click(); });
    expect(view.host.textContent).toContain('Read-only shared draft');
    expect(view.host.querySelector('select[aria-label="Teamkarten-Priorität"]')).toBeNull();
    expect(view.host.querySelector('select[aria-label="Teamkarten-Spalte"]')).toBeNull();
  } finally { await view.cleanup(); }
});

it('drops a cached board when the coordinator rejects a later access check', async () => {
  const view = setup(false);
  try {
    await act(async () => { view.root.render(<RemoteTeamBoardView workspaceId={workspaceId} projectId={projectId} projectName="Synthetic app" onTeam={() => undefined} />); });
    expect(view.host.textContent).toContain('Build sign-in');
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.task-card')!.click(); });
    expect(view.host.querySelector('[role="dialog"]')).not.toBeNull();
    view.teamBoard.mockRejectedValueOnce(new Error('Access revoked.'));
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.board-filters button')!.click(); });
    expect(view.host.textContent).not.toContain('Build sign-in');
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    expect(view.host.textContent).toContain('Access revoked.');
  } finally { await view.cleanup(); }
});

it('reopens the selected draft after a temporary coordinator outage without retaining cached cards', async () => {
  const view = setup(false);
  try {
    await act(async () => { view.root.render(<RemoteTeamBoardView workspaceId={workspaceId} projectId={projectId} projectName="Synthetic app" onTeam={() => undefined} />); });
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.task-card')!.click(); });
    view.teamBoard.mockRejectedValueOnce(new Error("Error invoking remote method 'studio:teamBoard': Error: Coordinator is unavailable."));
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.board-filters button')!.click(); });
    expect(view.host.textContent).not.toContain('Build sign-in');
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.board-filters button')!.click(); });
    expect(view.host.textContent).toContain('Build sign-in');
    expect(view.host.querySelector('[role="dialog"]')).not.toBeNull();
  } finally { await view.cleanup(); }
});

it('uses the authorized, revisioned coordinator command for a priority change', async () => {
  const view = setup(true);
  try {
    await act(async () => { view.root.render(<RemoteTeamBoardView workspaceId={workspaceId} projectId={projectId} projectName="Synthetic app" onTeam={() => undefined} />); });
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.task-card')!.click(); });
    const select = view.host.querySelector<HTMLSelectElement>('select[aria-label="Teamkarten-Priorität"]')!;
    await act(async () => { select.value = 'high'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.team-card-priority button')!.click(); });
    expect(view.setTeamCardPriority).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, projectId, cardId, priority: 'high', expectedRevision: 0 }));
  } finally { await view.cleanup(); }
});
