export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

// Anchor Word types
export type AnchorInitResponse = {
  type: 'anchor_init';
  postId: string;
  hasChallenge: boolean;
  clues?: string[];
  attempts?: number;
};

export type AnchorCreateResponse = {
  type: 'anchor_create';
  postId: string;
  navigateTo?: string;
};

export type AnchorGuessResponse = {
  type: 'anchor_guess';
  postId: string;
  result: 'correct' | 'incorrect';
  attempts: number;
};

export type AnchorPostData = {
  answer: string; // lowercased answer
  clues: string[];
  attempts: number;
};
