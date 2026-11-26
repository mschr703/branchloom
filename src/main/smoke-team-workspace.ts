import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { safeStorage, type BrowserWindow } from 'electron';
import type { StudioStore } from './store';
import { TeamConnectionStore } from './team-connection-store';
import { TeamJoinAttemptStore } from './team-join-attempt';
import { TeamRemoteClient } from './team-remote-client';

const Y = require('yjs') as typeof import('yjs', { with: { 'resolution-mode': 'require' } });

/** Exercises the actual renderer, preload, IPC, encrypted owner storage, and loopback host. */
export async function runTeamWorkspaceVisibleSmoke(window: BrowserWindow, store: StudioStore,
  projectPath: string): Promise<void> {
  const project = store.createProject({ name: 'Synthetic team project', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
    title: 'Shared planning card', description: 'Accepted source description' });
  await new Promise<void>((resolve, reject) => {
    window.webContents.once('did-finish-load', () => resolve());
    window.webContents.once('did-fail-load', (_event, _code, detail) => reject(new Error(detail)));
    window.webContents.reload();
  });
  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const value = await predicate(); if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Team workspace smoke timed out: ' + label);
    };
    const select = await wait(() => document.querySelector('#project-select'), 'project selector');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(project.id)}); select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label')
      === 'Projekt auswählen: Synthetic team project' && document.querySelector('.board-columns'), 'selected project board');
    const team = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((button) => button.getAttribute('aria-label') === 'Team'), 'team button');
    team.click();
    const section = await wait(() => document.querySelector('.team-workspace-settings'), 'team settings');
    const form = await wait(() => section.querySelector('.team-workspace-form'), 'create form');
    const inputs = form.querySelectorAll('input');
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputSetter.call(inputs[0], 'Synthetic team'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputSetter.call(inputs[1], 'Owner'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    await wait(() => section.querySelector('.team-workspace-hosted'), 'hosted workspace');
    const hosted = await window.studio.hostedTeamProject(${JSON.stringify(project.id)});
    if (hosted.name !== 'Synthetic team' || hosted.members.length !== 1) throw new Error('Team creation was not persisted.');
    const inviteButton = [...section.querySelectorAll('button')].find((button) => button.textContent === 'Einladung erstellen');
    inviteButton.click();
    const secret = await wait(() => section.querySelectorAll('.team-workspace-invitation input')[1]?.value, 'invitation');
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Team invitation is malformed.');
    if (!section.isConnected || !document.querySelector('.team-workspace-invitation')) throw new Error('Team settings disappeared during the visible flow.');
    return { workspaceId: hosted.workspaceId, coordinatorUrl: hosted.coordinatorUrl, secret };
  })()`) as { workspaceId: string; coordinatorUrl: string; secret: string };
  const response = await fetch(`${result.coordinatorUrl}/v1/workspace`, { headers: {
    Authorization: `Bearer ${'invalid'.padEnd(43, '_')}`,
  } });
  if (response.status !== 401) throw new Error('Coordinator accepted an invalid credential.');
  const guestRoot = join(projectPath, 'team-guest');
  mkdirSync(guestRoot);
  const guest = new TeamRemoteClient(new TeamConnectionStore(guestRoot, safeStorage),
    new TeamJoinAttemptStore(guestRoot, safeStorage));
  const joined = await guest.beginJoin({ coordinatorUrl: result.coordinatorUrl,
    inviteSecret: result.secret, displayName: 'Guest' });
  if (joined.workspaceId !== result.workspaceId) throw new Error('Guest joined another workspace.');
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const value = await predicate(); if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Team workspace smoke timed out: ' + label);
    };
    const team = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((button) => button.getAttribute('aria-label') === 'Team');
    if (!team) throw new Error('Team view is unavailable.');
    team.click();
    const board = await wait(() => document.querySelector('.team-workspace-board'), 'shared board');
    if (!board.textContent.includes('Shared planning card')) throw new Error('Team card is absent from shared board.');
    board.querySelector('.team-workspace-card').click();
    const editor = await wait(() => document.querySelector('.team-card-draft textarea:not(:disabled)'), 'draft editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(editor, 'Owner note. '); editor.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(async () => (await window.studio.teamCardDraft({ workspaceId: ${JSON.stringify(result.workspaceId)},
      projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} })).revision === 1, 'saved owner edit');
    return true;
  })()`);
  const guestDocument = new Y.Doc();
  guestDocument.getText('body').insert(0, 'Guest note. ');
  const guestUpdate = Buffer.from(Y.encodeStateAsUpdate(guestDocument)).toString('base64');
  const guestResult = await guest.updateCardDraft({ workspaceId: result.workspaceId, projectId: project.id,
    cardId: card.id, mutationId: randomUUID(), update: guestUpdate });
  if (guestResult.revision !== 2) throw new Error('Guest draft edit did not follow owner edit.');
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const value = document.querySelector('.team-card-draft textarea')?.value ?? '';
      if (value.includes('Owner note.') && value.includes('Guest note.')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Guest draft edit did not reach the visible owner editor.');
  })()`);
  if (store.snapshot(project.id).cards.find((item) => item.id === card.id)?.description !== 'Accepted source description') {
    throw new Error('A draft edit changed the accepted card description.');
  }
  guestDocument.destroy();
  const screenshot = process.env.BRANCHLOOM_TEAM_WORKSPACE_SCREENSHOT;
  if (screenshot) {
    window.showInactive();
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    writeFileSync(screenshot, (await window.capturePage()).toPNG());
    window.hide();
  }
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  const hidden = await window.webContents.executeJavaScript(`document.body.textContent.includes(${JSON.stringify(result.secret)})`);
  if (hidden) throw new Error('A one-time invitation remained visible after reload.');
  const connections = await window.webContents.executeJavaScript('window.studio.teamConnections()') as Array<{ workspaceId: string }>;
  if (!connections.some((item) => item.workspaceId === result.workspaceId)) throw new Error('Encrypted owner connection was not retained.');
}
