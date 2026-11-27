import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StudioStore } from './store';

/** Exercise the real renderer/IPC save path with a synthetic, source-backed reply. */
export async function runChatCanvasSmoke(window: BrowserWindow, store: StudioStore, root: string): Promise<void> {
  const projectPath = join(root, 'chat-canvas-project');
  mkdirSync(projectPath);
  const project = store.createProject({ name: 'Chat canvas smoke', path: projectPath });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Canvas smoke source',
    description: 'The synthetic queue source is stored in this card.' });
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  const savedId = await window.webContents.executeJavaScript(`(async () => {
    const projectId = ${JSON.stringify(project.id)};
    const sourceId = ${JSON.stringify(card.id)};
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 180; attempt++) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Chat canvas UI timeout: ' + label);
    };
    const chooseProject = async () => {
      const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
      picker.click();
      const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
        .find((item) => item.getAttribute('aria-label') === 'Chat canvas smoke auswählen'), 'project choice');
      choice.click();
      await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Chat canvas smoke', 'selected project');
    };
    await chooseProject();
    const chatNav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Projektgespräch'), 'chat navigation');
    chatNav.click();
    const chat = await wait(() => document.querySelector('.project-chat[aria-label="Projektgespräch"]'), 'project chat');
    const question = chat.querySelector('#project-chat-message');
    const questionSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!question || !questionSetter) throw new Error('Project question editor is unavailable.');
    questionSetter.call(question, 'BRANCHLOOM_CHAT_CANVAS_SMOKE');
    question.dispatchEvent(new Event('input', { bubbles: true }));
    const ask = await wait(() => chat.querySelector('.project-chat-compose button[type="submit"]:not([disabled])'), 'ask action');
    ask.click();
    const draft = await wait(() => chat.querySelector('.project-chat-draft'), 'sourced canvas outline');
    await wait(() => draft.querySelector('.project-chat-source-id') || chat.querySelector('.project-chat-source-id'), 'source citation');
    if (!chat.textContent?.includes('task:' + sourceId)) throw new Error('Synthetic answer did not cite the saved card.');
    if ((await window.studio.whiteboard(projectId)).nodes.length !== 0) throw new Error('Chat created a Whiteboard box before the explicit click.');
    const title = draft.querySelector('input');
    const titleSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!title || !titleSetter) throw new Error('Canvas title editor is unavailable.');
    titleSetter.call(title, 'Edited canvas outline');
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const save = await wait(() => [...draft.querySelectorAll('button')]
      .find((item) => item.textContent?.includes('Im Whiteboard speichern') && !item.disabled), 'explicit save action');
    save.click();
    await wait(() => document.querySelector('.wb-view') && document.querySelector('.wb-inspector input')?.value === 'Edited canvas outline', 'opened saved Whiteboard box');
    const board = await window.studio.whiteboard(projectId);
    if (board.nodes.length !== 1 || board.nodes[0].title !== 'Edited canvas outline'
      || !board.nodes[0].description.includes('task:' + sourceId)
      || !board.nodes[0].description.includes('Im Gespräch angezeigte Belege')) {
      throw new Error('Saved Whiteboard node lost its edited title or cited source.');
    }
    const snapshot = await window.studio.snapshot(projectId);
    if (snapshot.cards.length !== 1 || snapshot.sessions.length !== 0) throw new Error('Canvas save created a card or agent session.');
    return board.nodes[0].id;
  })()`);
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const projectId = ${JSON.stringify(project.id)};
    const nodeId = ${JSON.stringify(savedId)};
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 180; attempt++) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Chat canvas reload timeout: ' + label);
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === 'Chat canvas smoke auswählen'), 'project choice');
    choice.click();
    const whiteboardNav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Whiteboard'), 'Whiteboard navigation');
    whiteboardNav.click();
    const node = await wait(() => [...document.querySelectorAll('.wb-node')]
      .find((item) => item.textContent?.includes('Edited canvas outline')), 'persisted node');
    node.click();
    await wait(() => document.querySelector('.wb-inspector input')?.value === 'Edited canvas outline', 'node inspector after reload');
    const board = await window.studio.whiteboard(projectId);
    if (board.nodes.length !== 1 || board.nodes[0].id !== nodeId) throw new Error('Whiteboard node changed after renderer reload.');
    return true;
  })()`);
  if (process.env.BRANCHLOOM_CHAT_PREVIEW_SCREENSHOT) {
    await window.webContents.executeJavaScript(`(async () => {
      const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
        .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Projektgespräch');
      if (!nav) throw new Error('Project Chat navigation is missing after the canvas save.');
      nav.click();
      for (let attempt = 0; attempt < 60; attempt++) {
        if (document.querySelector('.project-chat-host.page .project-chat[aria-label="Projektgespräch"]')) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Project Chat did not reopen for the screenshot.');
    })()`);
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    writeFileSync(process.env.BRANCHLOOM_CHAT_PREVIEW_SCREENSHOT, (await window.capturePage()).toPNG());
  }
}
