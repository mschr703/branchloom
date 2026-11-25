import type { ComponentCatalog } from '../shared/component-catalog';
import type { ComponentRecommendationResult } from '../shared/component-recommendations';
import { recommendComponentsFromCard } from '../shared/component-recommendations';
import type { StudioStore } from './store';
import { scanProjectComponents } from './component-catalog';

type Scanner = (projectPath: string) => Promise<ComponentCatalog>;

/** A read-only hint from current card text and bounded, Git-indexed source names. */
export async function componentRecommendations(
  store: StudioStore,
  cardId: string,
  scan: Scanner = scanProjectComponents,
): Promise<ComponentRecommendationResult> {
  const card = store.card(cardId);
  if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
  const projectPath = store.project(card.projectId).path;
  const revision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number }).content_revision;
  const catalog = await scan(projectPath);
  const current = store.card(cardId);
  const currentRevision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number }).content_revision;
  if (current.archivedAt || current.projectId !== card.projectId || currentRevision !== revision || store.project(card.projectId).path !== projectPath) {
    throw new Error('Karte oder Projekt wurde während der Suche geändert. Erneut prüfen.');
  }
  return {
    cardId,
    projectId: card.projectId,
    cardRevision: revision,
    scannedFiles: catalog.scannedFiles,
    partial: catalog.partial,
    notes: catalog.notes,
    recommendations: recommendComponentsFromCard(card.title, card.description, catalog.candidates),
  };
}
