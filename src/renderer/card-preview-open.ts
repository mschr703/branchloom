import type { CardDevEnvironment } from '../shared/dev-environment';
import type { StudioAPI } from '../shared/types';

export type CardPreviewBrowser = Pick<StudioAPI, 'verifyCardDevEnvironment' | 'browserNewTab' | 'browserNavigate'>;

/** Re-read the main process before a displayed card run opens a browser tab. */
export async function openCurrentCardPreview(api: CardPreviewBrowser, cardId: string,
  displayed: CardDevEnvironment): Promise<CardDevEnvironment> {
  const current = await api.verifyCardDevEnvironment({ cardId, expectedRunId: displayed.id });
  if (!current || current.id !== displayed.id || current.cardId !== cardId || current.state !== 'ready' || !current.managed) {
    throw new Error('Die Karten-Vorschau ist nicht mehr bereit. Prüfe ihren aktuellen Status.');
  }
  await api.browserNewTab();
  await api.browserNavigate(current.url);
  return current;
}
