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
  clues?: string[]; // derived from words by stripping anchor prefix/suffix
  attempts?: number; // per-user attempts
  hasSolved?: boolean;
  score?: number;
  // Reveal data when solved
  anchor?: string;
  words?: string[];
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
  attempts: number; // per-user attempts after this guess
  hasSolved?: boolean; // true when result is correct
  score?: number; // awarded points when correct
  anchor?: string; // include reveal data on correct
  words?: string[];
};

export type AnchorPostData = {
  anchor: string; // lowercased anchor substring
  words: string[]; // 4-6 words that begin OR end with anchor
  attempts: number;
};

// Leaderboard
export type LeaderboardEntry = {
  username: string;
  score: number;
  rank: number;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  top: LeaderboardEntry[];
  me?: { username: string; score: number; rank: number };
};
