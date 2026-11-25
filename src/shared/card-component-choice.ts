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
