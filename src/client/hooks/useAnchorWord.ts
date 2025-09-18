import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AnchorInitResponse,
  AnchorCreateResponse,
  AnchorGuessResponse,
} from '../../shared/types/api';

export type GuessResult = 'idle' | 'correct' | 'incorrect';

export interface AnchorState {
  loading: boolean;
  postId: string | null;
  hasChallenge: boolean;
  clues: string[];
  attempts: number;
  result: GuessResult;
}

export const useAnchorWord = () => {
  const [state, setState] = useState<AnchorState>({
    loading: true,
    postId: null,
    hasChallenge: false,
    clues: [],
    attempts: 0,
    result: 'idle',
  });
  const [guess, setGuess] = useState('');

  // init
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/anchor/init');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AnchorInitResponse = await res.json();
        if (data.type !== 'anchor_init') throw new Error('Unexpected response');
        setState((s) => ({
          ...s,
          loading: false,
          postId: data.postId,
          hasChallenge: data.hasChallenge,
          clues: data.clues ?? [],
          attempts: data.attempts ?? 0,
          result: 'idle',
        }));
      } catch (e) {
        console.error('Failed to init anchor', e);
        setState((s) => ({ ...s, loading: false }));
      }
    })();
  }, []);

  const createChallenge = useCallback(
    async (answer: string, clues: string[]) => {
      try {
        const res = await fetch('/api/anchor/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer, clues }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AnchorCreateResponse = await res.json();
        if (data.type !== 'anchor_create') throw new Error('Unexpected response');
        setState((s) => ({
          ...s,
          hasChallenge: true,
          clues,
          attempts: 0,
          result: 'idle',
        }));
        if (data.navigateTo) {
          // Open the new post in a separate tab to avoid iframe CSP violations
          window.open(data.navigateTo, '_blank', 'noopener');
        }
      } catch (e) {
        console.error('Failed to create challenge', e);
      }
    },
    []
  );

  const submitGuess = useCallback(async () => {
    if (!guess.trim()) return;
    try {
      const res = await fetch('/api/anchor/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnchorGuessResponse = await res.json();
      if (data.type !== 'anchor_guess') throw new Error('Unexpected response');
      setState((s) => ({ ...s, result: data.result, attempts: data.attempts }));
    } catch (e) {
      console.error('Failed to submit guess', e);
    }
  }, [guess]);

  const canGuess = useMemo(() => state.hasChallenge && !state.loading, [state.hasChallenge, state.loading]);

  return {
    state,
    guess,
    setGuess,
    createChallenge,
    submitGuess,
    canGuess,
  } as const;
};
