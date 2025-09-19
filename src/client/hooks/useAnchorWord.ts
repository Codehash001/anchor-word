import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  hasSolved: boolean;
  anchor?: string;
  words?: string[];
  lastScoreAward?: number;
  isCreator?: boolean;
}

export const useAnchorWord = () => {
  const [state, setState] = useState<AnchorState>({
    loading: true,
    postId: null,
    hasChallenge: false,
    clues: [],
    attempts: 0,
    result: 'idle',
    hasSolved: false,
    isCreator: false,
  });
  const [guess, setGuess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refetch init logic encapsulated so we can auto-refresh
  const loadInit = useCallback(async () => {
    try {
      const res = await fetch('/api/anchor/init');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnchorInitResponse = await res.json();
      if (data.type !== 'anchor_init') throw new Error('Unexpected response');
      setState((s) => {
        const next: AnchorState = {
          ...s,
          loading: false,
          postId: data.postId,
          hasChallenge: data.hasChallenge,
          clues: data.clues ?? [],
          attempts: data.attempts ?? 0,
          result: 'idle',
          hasSolved: !!data.hasSolved,
          isCreator: (data as any).isCreator === true,
        };
        if (typeof data.anchor === 'string') next.anchor = data.anchor;
        if (Array.isArray(data.words)) next.words = data.words;
        if (typeof (data as any).score === 'number') next.lastScoreAward = (data as any).score as number;
        return next;
      });
    } catch (e) {
      console.error('Failed to init anchor', e);
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  // init
  useEffect(() => {
    loadInit();
  }, [loadInit]);

  // Auto-refresh polling: if no challenge found, retry a few times (helps with Reddit indexing delay)
  const retryRef = useRef(0);
  useEffect(() => {
    if (state.loading) return;
    if (state.hasChallenge) return;
    if (retryRef.current >= 5) return;
    const t = setTimeout(() => {
      retryRef.current += 1;
      loadInit();
    }, 2000);
    return () => clearTimeout(t);
  }, [state.loading, state.hasChallenge, loadInit]);

  const createChallenge = useCallback(
    async (
      anchor: string,
      words: string[]
    ): Promise<{ ok: true; navigateTo?: string } | { ok: false; message: string }> => {
      const attempt = async (): Promise<{ ok: true; navigateTo?: string } | { ok: false; message: string }> => {
        const res = await fetch('/api/anchor/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anchor, words }),
        });
        if (!res.ok) {
          try {
            const errorData = await res.json();
            // Extract the message from the error response
            const errorMessage = errorData.message || errorData.error || `HTTP ${res.status}`;
            return { ok: false, message: errorMessage } as const;
          } catch {
            // If JSON parsing fails, use the raw text or status
            const text = await res.text();
            return { ok: false, message: text || `HTTP ${res.status}` } as const;
          }
        }
        const data: AnchorCreateResponse = await res.json();
        return { ok: true, navigateTo: (data as any).navigateTo } as const;
      };

      for (let i = 0; i < 3; i++) {
        try {
          const out = await attempt();
          if (out.ok) return out;
          // only retry on server-side/transient errors
          if (!/HTTP\s(5\d\d|429)/.test(out.message)) return out;
        } catch (e) {
          // network or fetch error: retry
          if (i === 2) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, message: msg } as const;
          }
        }
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i))); // 500ms, 1s, 2s
      }
      return { ok: false, message: 'Failed to create challenge after retries.' } as const;
    },
    []
  );

  const submitGuess = useCallback(async () => {
    const g = guess.trim().toLowerCase();
    if (!g) return;
    setIsSubmitting(true);

    // Optimistic fast validation on client if we have the anchor
    setState((s) => {
      const localAnchor = s.anchor?.toLowerCase();
      if (localAnchor) {
        const correct = g === localAnchor;
        const next: AnchorState = {
          ...s,
          result: correct ? 'correct' : 'incorrect',
          // Optimistically increment attempts for incorrect
          attempts: correct ? s.attempts : s.attempts + 1,
          hasSolved: s.hasSolved || correct,
        };
        return next;
      }
      return s;
    });

    try {
      const res = await fetch('/api/anchor/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: g }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnchorGuessResponse = await res.json();
      if (data.type !== 'anchor_guess') throw new Error('Unexpected response');
      setState((s) => {
        const next: AnchorState = {
          ...s,
          result: data.result,
          attempts: data.attempts,
          hasSolved: s.hasSolved || !!data.hasSolved,
        };
        if (typeof data.score === 'number') next.lastScoreAward = data.score;
        if (typeof data.anchor === 'string') next.anchor = data.anchor;
        if (Array.isArray(data.words)) next.words = data.words;
        return next;
      });
    } catch (e) {
      console.error('Failed to submit guess', e);
    } finally {
      setIsSubmitting(false);
    }
  }, [guess]);

  const canGuess = useMemo(
    () => state.hasChallenge && !state.loading && !state.hasSolved && !state.isCreator,
    [state.hasChallenge, state.loading, state.hasSolved, state.isCreator]
  );

  return {
    state,
    guess,
    setGuess,
    createChallenge,
    submitGuess,
    canGuess,
    isSubmitting,
  } as const;
};
