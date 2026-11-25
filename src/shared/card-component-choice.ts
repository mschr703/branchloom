import type { ComponentCandidate } from './component-catalog';

export interface CardComponentChoice {
  id: string;
  cardId: string;
  projectId: string;
  name: string;
  path: string;
  line: number;
  sourceFingerprint: string;
  purpose: string;
  addedAt: string;
  current: boolean;
  variants: CardComponentVariant[];
}

export interface CardComponentVariant {
  id: string;
  label: string;
  previewUrl: string;
  reportId: string;
  capturedAt: string;
  sourceFingerprint: string;
}

export interface ProjectComponentLibraryVariant extends CardComponentVariant {
  sourceCardId: string;
  sourceCardTitle: string;
}

export interface ProjectComponentLibraryEntry {
  name: string;
  path: string;
  line: number;
  sourceFingerprint: string;
  purpose: string;
  sourceCardId: string;
  sourceCardTitle: string;
  usedByCards: number;
  currentCandidate: ComponentCandidate | null;
  variants: ProjectComponentLibraryVariant[];
}

export interface ProjectComponentLibrary {
  projectId: string;
  entries: ProjectComponentLibraryEntry[];
  limited: boolean;
  catalogPartial: boolean;
}

export interface AddCardComponentVariant {
  cardId: string;
  choiceId: string;
  expectedContentRevision: number;
  reportId: string;
  label: string;
}

export interface CardComponentChoiceState {
  cardId: string;
  contentRevision: number;
  choices: CardComponentChoice[];
}

export interface AddCardComponentChoice {
  cardId: string;
  expectedContentRevision: number;
  name: string;
  path: string;
  line: number;
  sourceFingerprint: string;
  purpose: string;
}
