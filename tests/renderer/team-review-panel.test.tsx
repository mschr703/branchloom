// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TeamReviewPanel } from '../../src/renderer/components/TeamReviewPanel';
import type { Card, CardQaReport } from '../../src/shared/types';
import type { TeamReviewRoom } from '../../src/shared/team-review';

const card: Card = { id: 'card', projectId: 'project', columnId: 'todo', title: 'Review settings', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', archivedAt: null };
const report: CardQaReport = { id: 'report', cardId: 'card', projectId: 'project', requestedUrl: 'http://127.0.0.1:5173/settings', finalUrl: null, startedAt: '2026-01-01', endedAt: '2026-01-01', status: 'passed', diagnostics: [], pageCheck: 'complete', pageObservations: [], note: null, screenshotAvailable: true, viewportWidth: 1200, viewportHeight: 800, gitEvidence: null };
const room: TeamReviewRoom = { id: 'room', projectId: 'project', cardId: 'card', qaReportId: 'report', scenario: 'Signed out settings', imageSha256: 'a'.repeat(64), imageWidth: 1200, imageHeight: 800, checkoutObservation: null, createdAt: '2026-01-01', closedAt: null };

it('creates a room only after a click and keeps the scoped link visible for the owner', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const startTeamReviewRoom = vi.fn().mockResolvedValue({ room, invite: { id: 'invite', roomId: 'room', displayName: 'Alex', role: 'reviewer', createdAt: '2026-01-01', revokedAt: null }, reviewerSecret: 'secret', url: 'http://127.0.0.1:1234/r/secret' });
  const copyTeamReviewInvite = vi.fn().mockResolvedValue(undefined);
  const newTailnetTeamReviewInvite = vi.fn().mockResolvedValue({ invite: { id: 'tail-invite', roomId: 'room', displayName: 'Sam', role: 'reviewer', createdAt: '2026-01-01', revokedAt: null }, reviewerSecret: 'tail-secret', url: 'http://100.101.102.103:4567/r/tail-secret' });
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    teamReviewRooms: vi.fn().mockResolvedValue([]), teamReviewInvites: vi.fn().mockResolvedValue([]),
    teamReviewComments: vi.fn().mockResolvedValue([]), teamReviewImage: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    teamReviewRevision: vi.fn().mockResolvedValue({ status: 'different-head', currentHead: 'b'.repeat(40), checkedAt: '2026-01-01T10:00:00Z' }),
    startTeamReviewRoom, copyTeamReviewInvite, newTailnetTeamReviewInvite,
  } });
  try {
    await act(async () => { root.render(<TeamReviewPanel card={card} report={report} />); });
    expect(startTeamReviewRoom).not.toHaveBeenCalled();
    expect(host.querySelector('.team-review-share')).toBeNull();
    await act(async () => { host.querySelector('summary')!.click(); });
    const inputs = host.querySelectorAll<HTMLInputElement>('.team-review-form input');
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setInput.call(inputs[0], 'Signed out settings');
      inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
      setInput.call(inputs[1], 'Alex');
      inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { host.querySelector<HTMLFormElement>('.team-review-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(startTeamReviewRoom).toHaveBeenCalledWith({ projectId: 'project', cardId: 'card', qaReportId: 'report', scenario: 'Signed out settings', reviewerName: 'Alex' });
    expect(host.querySelector<HTMLInputElement>('.team-review-share input')?.value).toBe('http://127.0.0.1:1234/r/secret');
    expect(host.querySelector('.team-review-revision')?.textContent).toContain('Git-HEAD seit QA geändert');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.team-review-share button')].find((button) => button.textContent === 'Link kopieren')!.click(); });
    expect(copyTeamReviewInvite).toHaveBeenCalledWith({ secret: 'secret', transport: 'local' });
    const nextReviewer = host.querySelector<HTMLInputElement>('.team-review-current .team-review-form input')!;
    await act(async () => {
      setInput.call(nextReviewer, 'Sam');
      nextReviewer.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.team-review-current button')].find((button) => button.textContent === 'Tailscale-Link erstellen')!.click(); });
    expect(newTailnetTeamReviewInvite).toHaveBeenCalledWith({ roomId: 'room', reviewerName: 'Sam' });
    expect(host.querySelector<HTMLInputElement>('.team-review-share input')?.value).toBe('http://100.101.102.103:4567/r/tail-secret');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.team-review-share button')].find((button) => button.textContent === 'Link kopieren')!.click(); });
    expect(copyTeamReviewInvite).toHaveBeenLastCalledWith({ secret: 'tail-secret', transport: 'tailnet' });
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
