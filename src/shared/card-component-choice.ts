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
