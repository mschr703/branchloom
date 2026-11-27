import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, safeStorage, type BrowserWindow } from 'electron';
import type { StudioStore } from './store';
import { TeamConnectionStore } from './team-connection-store';
import { TeamJoinAttemptStore } from './team-join-attempt';
import { TeamRemoteClient } from './team-remote-client';
import type { TeamLocalService } from './team-local-service';

const Y = require('yjs') as typeof import('yjs', { with: { 'resolution-mode': 'require' } });

/** Exercises the actual renderer, preload, IPC, encrypted owner storage, and loopback host. */
export async function runTeamWorkspaceVisibleSmoke(window: BrowserWindow, store: StudioStore,
  projectPath: string, host: TeamLocalService): Promise<void> {
  const boardScreenshot = process.env.BRANCHLOOM_TEAM_BOARD_OVERVIEW_SCREENSHOT;
  const narrowBoardScreenshot = process.env.BRANCHLOOM_TEAM_BOARD_NARROW_SCREENSHOT;
  const darkBoardScreenshot = process.env.BRANCHLOOM_TEAM_BOARD_DARK_SCREENSHOT;
  const dragBoardScreenshot = process.env.BRANCHLOOM_TEAM_BOARD_DRAG_SCREENSHOT;
  const projectName = boardScreenshot ? 'Fieldnotes' : 'Synthetic team project';
  const project = store.createProject({ name: projectName, path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
    title: boardScreenshot ? 'Plan workspace permissions' : 'Shared planning card',
    description: boardScreenshot ? 'Decide who can approve plans and invite reviewers.' : 'Accepted source description',
    ...(boardScreenshot ? { priority: 'high' as const, labels: ['Team'] } : {}) });
  await new Promise<void>((resolve, reject) => {
    window.webContents.once('did-finish-load', () => resolve());
    window.webContents.once('did-fail-load', (_event, _code, detail) => reject(new Error(detail)));
    window.webContents.reload();
  });
  if (boardScreenshot) {
    const columns = store.snapshot(project.id).columns;
    const sampleAgent = store.saveAgent({ name: 'Atlas', kind: 'custom', command: 'node', args: [], model: null, enabled: true });
    if (columns[1]) store.updateColumn({ id: columns[1].id, agentId: sampleAgent.id });
    if (columns[2]) store.updateColumn({ id: columns[2].id, agentId: sampleAgent.id });
    store.createCard({ projectId: project.id, columnId: columns[0]!.id,
      title: 'Clarify the first project step', description: 'Show what a local folder import will index.', priority: 'medium', labels: ['Onboarding'] });
    store.createCard({ projectId: project.id, columnId: columns[1]?.id ?? columns[0]!.id,
      title: 'Review invitation flow', description: 'Keep project and team permissions distinct.', priority: 'medium', labels: ['Review'] });
    const runningPreviewCard = store.createCard({ projectId: project.id, columnId: columns[2]?.id ?? columns[0]!.id,
      title: 'Make board filters keyboard friendly', description: 'Keep search and filter state in view.', labels: ['Board'] });
    const runningPreview = store.createSession({ cardId: runningPreviewCard.id, agentId: sampleAgent.id });
    store.appendOutput(runningPreview.id, 'read  src/renderer/board-filters.ts\nedit  keyboard navigation for the filter row\ncheck focused controls in the preview\n');
    store.createCard({ projectId: project.id, columnId: columns[1]?.id ?? columns[0]!.id,
      title: 'Sketch project navigation', description: 'Compare the first route with the approved draft.', labels: ['Design'] });
    store.createCard({ projectId: project.id, columnId: columns[2]?.id ?? columns[0]!.id,
      title: 'Recover interrupted agent runs', description: 'Keep the last session and worktree available.', priority: 'high', labels: ['Agents'] });
    if (columns[3]) store.createCard({ projectId: project.id, columnId: columns[3].id,
      title: 'Inspect agent changes', description: 'Compare the diff with the card acceptance notes.', labels: ['Review'] });
    if (columns[4]) store.createCard({ projectId: project.id, columnId: columns[4].id,
      title: 'Check release notes', description: 'Confirm that the visible changes are documented.', labels: ['Docs'] });
    const boardReady = await window.webContents.executeJavaScript(`(async () => {
      const select = document.querySelector('#project-select');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Synthetic board selector is missing.');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, ${JSON.stringify(project.id)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (document.querySelector('.board-columns')?.textContent?.includes('Make board filters keyboard friendly')) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Synthetic board did not settle for screenshot.');
    })().catch((error) => ({ smokeError: String(error?.stack ?? error) }))`);
    if (boardReady && typeof boardReady === 'object' && 'smokeError' in boardReady) throw new Error(String(boardReady.smokeError));
    if (window.isVisible()) throw new Error('Board screenshot must not take over the active desktop.');
    const originalSize = window.getSize();
    try {
      window.setSize(1440, 900);
      await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      writeFileSync(boardScreenshot, (await window.capturePage()).toPNG());
      if (narrowBoardScreenshot) {
        window.setSize(430, 760);
        await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const cardTop = await window.webContents.executeJavaScript(`(() => document.querySelector('.board-card-wrap')?.getBoundingClientRect().top ?? Infinity)()`);
        if (cardTop >= 760) throw new Error('Board cards are below the first narrow viewport.');
        writeFileSync(narrowBoardScreenshot, (await window.capturePage()).toPNG());
      }
      if (darkBoardScreenshot) {
        window.setSize(1440, 900);
        await window.webContents.executeJavaScript(`(async () => {
          const toggle = document.querySelector('.theme-toggle');
          if (!(toggle instanceof HTMLButtonElement)) throw new Error('Theme toggle is missing.');
          toggle.click();
          for (let attempt = 0; attempt < 30 && document.documentElement.dataset.theme !== 'dark'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
          if (document.documentElement.dataset.theme !== 'dark') throw new Error('Dark board theme did not activate.');
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 180));
        writeFileSync(darkBoardScreenshot, (await window.capturePage()).toPNG());
        await window.webContents.executeJavaScript(`(() => document.querySelector('.theme-toggle')?.click())()`);
      }
      if (dragBoardScreenshot) {
        window.setSize(1440, 900);
        await window.webContents.executeJavaScript(`(() => {
          const card = document.querySelector('.board-card-wrap .task-card');
          const columns = [...document.querySelectorAll('.board-column')];
          if (!(card instanceof HTMLButtonElement) || columns.length < 2) throw new Error('Draggable synthetic board card is missing.');
          const start = card.getBoundingClientRect();
          const target = columns[1].getBoundingClientRect();
          const transfer = new DataTransfer();
          card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: start.left + 32, clientY: start.top + 24 }));
          window.__syntheticDragTransfer = transfer;
          window.__syntheticDragTarget = { x: target.left + 80, y: target.top + 110 };
          return true;
        })()`);
        await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        const previewReady = await window.webContents.executeJavaScript(`(() => {
          const target = document.querySelectorAll('.board-column')[1];
          target?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__syntheticDragTransfer, clientX: window.__syntheticDragTarget.x, clientY: window.__syntheticDragTarget.y }));
          return Boolean(document.querySelector('.board-drag-preview'));
        })()`);
        await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        const targetReady = await window.webContents.executeJavaScript(`(() => Boolean(document.querySelector('.board-column.is-drop-target')))()`);
        if (!previewReady || !targetReady) throw new Error(`Synthetic drag feedback is incomplete (preview: ${previewReady}, target: ${targetReady}).`);
        writeFileSync(dragBoardScreenshot, (await window.capturePage()).toPNG());
        await window.webContents.executeJavaScript(`(() => {
          document.querySelector('.board-card-wrap .task-card')?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__syntheticDragTransfer }));
          delete window.__syntheticDragTransfer;
          delete window.__syntheticDragTarget;
        })()`);
      }
      await window.webContents.executeJavaScript(`(() => {
        const actions = document.querySelector('.board-more-tools');
        const filters = document.querySelector('.board-filter-options');
        if (!(actions instanceof HTMLDetailsElement) || !(filters instanceof HTMLDetailsElement)) throw new Error('Board menus are missing.');
        actions.querySelector('summary')?.click();
        if (!actions.open || !actions.textContent?.includes('Trello-Ideen sammeln') || !actions.textContent?.includes('UI-Prüfung')) throw new Error('Board actions did not open.');
        actions.querySelector('summary')?.click();
        filters.querySelector('summary')?.click();
        if (!filters.open || filters.querySelectorAll('select').length !== 4) throw new Error('Board filters did not open.');
        filters.querySelector('summary')?.click();
        return true;
      })()`);
    } finally {
      store.finishSession(runningPreview.id, 'stopped', null);
      window.setSize(originalSize[0]!, originalSize[1]!);
    }
  }
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
      === ${JSON.stringify(`Projekt auswählen: ${projectName}`)} && document.querySelector('.board-columns'), 'selected project board');
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
  const secondPath = join(projectPath, 'second-project');
  mkdirSync(secondPath);
  const secondProject = store.createProject({ name: 'Private second project', path: secondPath });
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  const guestRoot = join(projectPath, 'team-guest');
  mkdirSync(guestRoot);
  const guest = new TeamRemoteClient(new TeamConnectionStore(guestRoot, safeStorage),
    new TeamJoinAttemptStore(guestRoot, safeStorage));
  const joined = await guest.beginJoin({ coordinatorUrl: result.coordinatorUrl,
    inviteSecret: result.secret, displayName: 'Guest' });
  if (joined.workspaceId !== result.workspaceId) throw new Error('Guest joined another workspace.');
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 160; attempt += 1) {
        const value = await predicate(); if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Second project smoke timed out: ' + label);
    };
    const selector = document.querySelector('#project-select');
    if (!(selector instanceof HTMLSelectElement)) throw new Error('Project selector is unavailable.');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(selector, ${JSON.stringify(secondProject.id)});
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    const team = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((button) => button.getAttribute('aria-label') === 'Team'), 'team navigation');
    team.click();
    const attach = await wait(() => document.querySelector('.team-workspace-attach'), 'attach project controls');
    const add = [...attach.querySelectorAll('button')].find((button) => button.textContent === 'Projekt hinzufügen');
    if (!add) throw new Error('Attach action is unavailable.');
    add.click();
    const confirm = await wait(() => [...attach.querySelectorAll('button')]
      .find((button) => button.textContent === 'Projekt hinzufügen bestätigen'), 'attach confirmation');
    confirm.click();
    await wait(async () => (await window.studio.hostedTeamProject(${JSON.stringify(secondProject.id)}))?.defaultMemberAccess === 'none',
      'private project default');
    return true;
  })()`);
  if ((await guest.workspace(result.workspaceId)).projects.some((item) => item.id === secondProject.id)) {
    throw new Error('A newly attached project was visible to the guest before its grant.');
  }
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const value = await predicate(); if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Second project grant timed out: ' + label);
    };
    const setup = document.querySelector('.team-workspace-setup');
    if (!(setup instanceof HTMLDetailsElement)) throw new Error('Team settings are unavailable.');
    setup.open = true;
    const refresh = await wait(() => [...setup.querySelectorAll('button')]
      .find((button) => button.textContent === 'Mitglieder aktualisieren'), 'member refresh');
    refresh.click();
    const member = await wait(() => [...setup.querySelectorAll('.team-workspace-members li')]
      .find((item) => item.textContent?.includes('Guest')), 'guest member');
    const rights = member.querySelector('.team-workspace-member-rights');
    if (!(rights instanceof HTMLDetailsElement)) throw new Error('Project rights are unavailable.');
    rights.open = true;
    const access = rights.querySelector('select');
    if (!(access instanceof HTMLSelectElement) || !access.textContent?.includes('Projektstandard: kein Zugang')) {
      throw new Error('The new project did not show its private default.');
    }
    await wait(() => !access.disabled, 'enabled project access');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(access, 'read'); access.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      await wait(async () => (await window.studio.hostedTeamProject(${JSON.stringify(secondProject.id)}))?.members
        .some((item) => item.id === ${JSON.stringify(joined.memberId)} && item.projectAccess === 'read'), 'saved read access');
    } catch (reason) {
      const current = await window.studio.hostedTeamProject(${JSON.stringify(secondProject.id)});
      throw new Error(String(reason) + '; members=' + JSON.stringify(current?.members.map((item) => ({
        id: item.id, name: item.displayName, access: item.projectAccess }))) + '; ui=' + rights.textContent?.slice(0, 500));
    }
    const selector = document.querySelector('#project-select');
    setter.call(selector, ${JSON.stringify(project.id)}); selector.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.querySelector('.team-workspace-settings select')?.textContent?.includes('Teamrolle übernehmen'),
      'original project rights');
    return true;
  })()`);
  if (!(await guest.workspace(result.workspaceId)).projects.some((item) => item.id === secondProject.id)) {
    throw new Error('The granted guest cannot see the second project.');
  }
  const guestWatch = new AbortController();
  let guestReady: () => void = () => undefined;
  let guestFailed: (error: unknown) => void = () => undefined;
  const guestPresence = new Promise<void>((resolve, reject) => { guestReady = resolve; guestFailed = reject; });
  const guestWatchTask = guest.streamCardDraft({ workspaceId: result.workspaceId, projectId: project.id, cardId: card.id },
    (event) => { if (event.type === 'presence') guestReady(); }, guestWatch.signal);
  void guestWatchTask.catch(guestFailed);
  await guestPresence;
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
    if (!board.textContent.includes(${JSON.stringify(card.title)})) throw new Error('Team card is absent from shared board.');
    board.querySelector('.team-workspace-card').click();
    const editor = await wait(() => document.querySelector('.team-card-draft textarea:not(:disabled)'), 'draft editor');
    const priority = await wait(() => document.querySelector('select[aria-label="Teamkarten-Priorität"]'), 'priority control');
    const prioritySetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    prioritySetter.call(priority, 'high'); priority.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.team-card-priority .secondary-button').click();
    await wait(async () => (await window.studio.teamBoard({ workspaceId: ${JSON.stringify(result.workspaceId)},
      projectId: ${JSON.stringify(project.id)} })).cards.find((item) => item.id === ${JSON.stringify(card.id)})?.priority === 'high',
      'revisioned team priority command');
    await wait(() => document.querySelector('.team-workspace-card.selected small')?.textContent === 'high',
      'refreshed card revision before moving');
    const column = await wait(() => document.querySelector('select[aria-label="Teamkarten-Spalte"]'), 'column control');
    const destination = [...column.options].find((option) => option.value !== column.value);
    if (!destination) throw new Error('Team board needs another column for a visible move.');
    prioritySetter.call(column, destination.value); column.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => !column.closest('.team-card-priority')?.querySelector('.secondary-button')?.disabled, 'move enabled');
    column.closest('.team-card-priority').querySelector('.secondary-button').click();
    await wait(async () => (await window.studio.teamBoard({ workspaceId: ${JSON.stringify(result.workspaceId)},
      projectId: ${JSON.stringify(project.id)} })).cards.find((item) => item.id === ${JSON.stringify(card.id)})?.columnId === destination.value,
      'revisioned team column move');
    await wait(() => document.querySelector('.team-workspace-detail [role="status"]')?.textContent?.includes('Spalte gespeichert'),
      'visible move confirmation');
    await wait(() => document.querySelector('.team-card-presence')?.textContent?.includes('Live verbunden') &&
      document.querySelector('.team-card-presence')?.textContent?.includes('Owner') &&
      document.querySelector('.team-card-presence')?.textContent?.includes('Guest'), 'live team presence');
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
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const value = document.querySelector('.team-card-draft textarea')?.value ?? '';
      if (value.includes('Owner note.') && value.includes('Guest note.')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Guest draft edit did not reach the visible owner editor.');
  })()`);
  if (store.snapshot(project.id).cards.find((item) => item.id === card.id)?.description !== card.description) {
    throw new Error('A draft edit changed the accepted card description.');
  }
  const ownerConnection = await new TeamConnectionStore(app.getPath('userData'), safeStorage).get(result.workspaceId);
  if (!ownerConnection) throw new Error('Synthetic owner connection is unavailable.');
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const value = await predicate(); if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Team rights smoke timed out: ' + label);
    };
    const setup = document.querySelector('.team-workspace-setup');
    if (!(setup instanceof HTMLDetailsElement)) throw new Error('Team settings are unavailable.');
    setup.open = true;
    const refresh = [...setup.querySelectorAll('button')]
      .find((button) => button.textContent === 'Mitglieder aktualisieren');
    if (!refresh) throw new Error('Member refresh is unavailable.');
    refresh.click();
    const member = await wait(() => [...setup.querySelectorAll('.team-workspace-members li')]
      .find((item) => item.textContent?.includes('Guest')), 'joined member');
    const rights = member.querySelector('.team-workspace-member-rights');
    if (!(rights instanceof HTMLDetailsElement)) throw new Error('Project rights are unavailable.');
    rights.open = true;
    const allow = await wait(() => [...rights.querySelectorAll('button')]
      .find((button) => button.textContent === 'Aufgabensteuerung erlauben' && !button.disabled), 'task grant action');
    allow.click();
    const confirm = await wait(() => [...rights.querySelectorAll('button')]
      .find((button) => button.textContent === 'Aufgabensteuerung bestätigen'), 'task grant confirmation');
    confirm.click();
    await wait(async () => (await window.studio.hostedTeamProject(${JSON.stringify(project.id)}))?.members
      .some((item) => item.id === ${JSON.stringify(joined.memberId)} && item.extraCapabilities.includes('manage_task')),
      'persisted task grant');
    return true;
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    window.__teamCardEventSeen = false;
    window.__stopTeamCardEventCheck = window.studio.onTeamDraftEvent((event) => {
      if ('event' in event && event.event.type === 'card') window.__teamCardEventSeen = true;
    });
    return true;
  })()`);
  const returnColumn = store.snapshot(project.id).columns[0]!.id;
  const beforeGuestMove = (await guest.board({ workspaceId: result.workspaceId, projectId: project.id }))
    .cards.find((item) => item.id === card.id);
  if (!beforeGuestMove) throw new Error('Guest cannot see the team card before moving it.');
  await guest.moveCard({ workspaceId: result.workspaceId, projectId: project.id, cardId: card.id,
    columnId: returnColumn, expectedRevision: beforeGuestMove.revision, mutationId: randomUUID() });
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const selected = document.querySelector('.team-workspace-card.selected');
      if (window.__teamCardEventSeen && selected?.closest('section')?.getAttribute('aria-label') ===
        'Spalte ' + ${JSON.stringify(store.snapshot(project.id).columns[0]!.name)}) {
        window.__stopTeamCardEventCheck();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    window.__stopTeamCardEventCheck();
    throw new Error('Guest card move did not reach the visible owner board through the event stream.');
  })()`);
  guestDocument.destroy();
  guestWatch.abort();
  await guestWatchTask;
  await host.close();
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (document.querySelector('.team-card-presence')?.textContent?.includes('unterbrochen')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The owner editor did not report the stopped coordinator.');
  })()`);
  await window.webContents.executeJavaScript(`(async () => {
    const editor = document.querySelector('.team-card-draft textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    if (!(editor instanceof HTMLTextAreaElement) || !setter || editor.disabled) {
      throw new Error('The disconnected owner editor is unavailable.');
    }
    setter.call(editor, editor.value + ' Offline owner note.');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const pending = await window.studio.pendingTeamCardDraftUpdates({ workspaceId: ${JSON.stringify(result.workspaceId)},
        projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} });
      if (pending.length === 1 && document.querySelector('.team-card-draft .inline-error')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The disconnected owner edit was not stored in the encrypted outbox.');
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const stillPending = await window.webContents.executeJavaScript(`window.studio.pendingTeamCardDraftUpdates({
    workspaceId: ${JSON.stringify(result.workspaceId)}, projectId: ${JSON.stringify(project.id)},
    cardId: ${JSON.stringify(card.id)} })`) as Array<{ mutationId: string }>;
  if (stillPending.length !== 1 || !stillPending[0]?.mutationId) {
    throw new Error('The offline edit was lost or duplicated during a polling interval.');
  }
  if (await host.resumeSavedHost() !== result.coordinatorUrl) throw new Error('Coordinator did not reuse its saved port.');
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const pending = await window.studio.pendingTeamCardDraftUpdates({ workspaceId: ${JSON.stringify(result.workspaceId)},
        projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} });
      const draft = await window.studio.teamCardDraft({ workspaceId: ${JSON.stringify(result.workspaceId)},
        projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} });
      const text = document.querySelector('.team-card-draft textarea')?.value ?? '';
      if (document.querySelector('.team-card-presence')?.textContent?.includes('Live verbunden') && !pending.length &&
        draft.revision === 3 && text.includes('Guest note.') && text.includes('Owner note.') &&
        text.includes('Offline owner note.')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The owner editor did not replay its offline edit after coordinator restart.');
  })()`);
  if ((await guest.cardDraft({ workspaceId: result.workspaceId, projectId: project.id, cardId: card.id })).revision !== 3) {
    throw new Error('The replayed draft was not retained after coordinator restart.');
  }
  await new Promise((resolve) => setTimeout(resolve, 5_500));
  if ((await guest.cardDraft({ workspaceId: result.workspaceId, projectId: project.id, cardId: card.id })).revision !== 3) {
    throw new Error('A later poll replayed the same offline edit twice.');
  }
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
