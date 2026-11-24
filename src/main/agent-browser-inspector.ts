import { randomUUID } from 'node:crypto';
import { BrowserWindow, session } from 'electron';
import type { AgentBrowserPage } from '../shared/agent-browser';
import { checkedAgentBrowserOrigin, checkedAgentBrowserPath } from './agent-browser-policy';

const MAX_TEXT = 12_000;
const LOAD_TIMEOUT_MS = 15_000;

/** A one-shot, cookie-free browser. It never attaches to the user's persistent Browser tab. */
export async function inspectAgentBrowserPage(originInput: string, pathInput: string, stillAllowed: () => boolean): Promise<AgentBrowserPage> {
  const origin = checkedAgentBrowserOrigin(originInput);
  const path = checkedAgentBrowserPath(pathInput);
  if (!stillAllowed()) throw new Error('Agent browser permission was revoked.');
  const isolatedSession = session.fromPartition(`branchloom-agent-read-${randomUUID()}`);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.on('will-download', (event) => event.preventDefault());
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    let safe = false;
    try { safe = new URL(details.url).origin === origin && (details.method === 'GET' || details.method === 'HEAD'); }
    catch { /* Deny malformed and non-HTTP requests. */ }
    callback({ cancel: !safe });
  });
  const browser = new BrowserWindow({ show: false, width: 1024, height: 768,
    webPreferences: { session: isolatedSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyOtherOrigin = (event: Electron.Event, url: string) => {
    try { if (new URL(url).origin === origin) return; } catch { /* Deny malformed navigation. */ }
    event.preventDefault();
  };
  browser.webContents.on('will-navigate', denyOtherOrigin);
  browser.webContents.on('will-redirect', denyOtherOrigin);
  let timeout: NodeJS.Timeout | undefined;
  try {
    const url = new URL(path, `${origin}/`).href;
    await Promise.race([
      browser.loadURL(url),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Local browser page did not load within 15 seconds.')), LOAD_TIMEOUT_MS); }),
    ]);
    if (!stillAllowed()) throw new Error('Agent browser permission was revoked.');
    const finalUrl = browser.webContents.getURL();
    if (new URL(finalUrl).origin !== origin) throw new Error('The page left the approved local origin.');
    const content = await browser.webContents.executeJavaScript(`(() => {
      const title = document.title || '';
      const fullText = document.body?.innerText || '';
      return { title: title.slice(0, 300), text: fullText.slice(0, ${MAX_TEXT}), truncated: fullText.length > ${MAX_TEXT} };
    })()`) as { title: string; text: string; truncated: boolean };
    if (!stillAllowed() || browser.isDestroyed() || browser.webContents.getURL() !== finalUrl) throw new Error('The page or permission changed during inspection.');
    return { url: finalUrl, title: content.title, text: content.text, truncated: content.truncated, readAt: new Date().toISOString() };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!browser.isDestroyed()) browser.destroy();
    await isolatedSession.clearStorageData().catch(() => undefined);
  }
}
