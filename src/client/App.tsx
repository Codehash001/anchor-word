import { useMemo, useState } from 'react';
import { useAnchorWord } from './hooks/useAnchorWord';

export const App = () => {
  const { state, guess, setGuess, createChallenge, submitGuess, canGuess } = useAnchorWord();
  const [creating, setCreating] = useState(false);
  // Create screen state
  const [anchor, setAnchor] = useState('');
  const [words, setWords] = useState<string[]>(['', '', '', '', '', '']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');


  const canSubmitCreate = useMemo(() => {
    const a = anchor.trim();
    const filled = words.map((w) => w.trim()).filter(Boolean);
    const okCount = filled.length >= 4 && filled.length <= 6;
    const okPattern = a.length > 0 && filled.every((w) => (w.startsWith(a) || w.endsWith(a)) && w.length > a.length);
    return okCount && okPattern;
  }, [anchor, words]);

  const onChangeWord = (i: number, value: string) => {
    setWords((arr) => arr.map((w, idx) => (idx === i ? value : w)));
  };

  const onCreate = async () => {
    setError('');
    const a = anchor.trim();
    const filled = words.map((w) => w.trim()).filter(Boolean);
    if (!a) {
      setError('Enter the shared anchor substring.');
      return;
    }
    if (filled.length < 4 || filled.length > 6) {
      setError('Please provide 4–6 words.');
      return;
    }
    if (!filled.every((w) => (w.startsWith(a) || w.endsWith(a)) && w.length > a.length)) {
      setError('Each word must start or end with the anchor and be longer than it.');
      return;
    }
    try {
      setSaving(true);
      await createChallenge(a, filled);
      setCreating(false);
      setAnchor('');
      setWords(['', '', '', '', '', '']);
    } finally {
      setSaving(false);
    }
  };

  // Dedicated screen: either gameplay or create mode
  if (creating) {
    return (
      <div className="theme-reddit p-4 md:p-6 max-w-3xl mx-auto">
        <div className="cc-box p-5 md:p-7">
          <div className="cc-header mb-2">
            <button className="cc-back" onClick={() => setCreating(false)} aria-label="Back">←</button>
            <div className="cc-title">Create Challenge</div>
            <div className="ml-auto muted" title="Help">?</div>
          </div>
          <p className="cc-subtitle">Enter 4–6 words that all contain the same anchor substring.</p>
          <input
            className="cc-input w-full mb-3"
            placeholder="bed"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
          />
          <div className="cc-grid mb-3">
            {words.map((w, i) => {
              const ph = ['bedroom', 'seabed', 'bedrock', 'bedsheet', 'Word 5', 'Word 6'][i] ?? `Word ${i + 1}`;
              return (
                <input
                  key={i}
                  className="cc-input"
                  placeholder={ph}
                  value={w}
                  onChange={(e) => onChangeWord(i, e.target.value)}
                />
              );
            })}
          </div>
          {error && <div className="result-wrong mb-2 text-sm">{error}</div>}
          <div className="flex items-center gap-3">
            <button className="cc-primary" onClick={onCreate} disabled={saving || !canSubmitCreate}>
              🚀 Create
            </button>
            {saving && <div className="muted">Creating...</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-reddit fullpane p-4 md:p-6 max-w-2xl mx-auto">
      <div className="cc-box p-5 md:p-7">
        <div className="pane-content">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-3">
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0b0b0b' }} />
              <div className="rdt-title text-[26px]">Anchor Word</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="attempts-pill" title="Number of attempts so far">
                Attempts: {state.attempts}
              </div>
              <div className="muted" role="img" aria-label="help">?</div>
            </div>
          </div>

          <p className="mt-2 cc-muted" style={{ fontSize: 16 }}>
            Guess the hidden anchor substring shared by all the words below.
          </p>

          {/* Clue chips */}
          <div className="chip-grid mt-2">
            {state.loading ? (
              <div>Loading…</div>
            ) : state.hasChallenge ? (
              state.clues.map((c, i) => (
                <div key={i} className="chip"><span className="text">{c}</span></div>
              ))
            ) : (
              <div className="cc-muted">No challenge found for this post. Use "Create a challenge" to get started.</div>
            )}
          </div>

          {/* Guess input */}
          <div className="guess-row mt-4">
            <input
              aria-label="Type your guess"
              placeholder="Type your guess"
              className="guess-input"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              disabled={!canGuess}
            />
            <button className="guess-btn" disabled={!canGuess} onClick={submitGuess}>
              Guess
            </button>
          </div>

          {/* Inline status banner below input */}
          {state.result !== 'idle' && (
            <div className={`status-banner ${state.result === 'correct' ? 'status-success' : 'status-error'}`}>
              <span className="status-emoji" role="img" aria-label={state.result === 'correct' ? 'success' : 'error'}>
                {state.result === 'correct' ? '🎉' : '❌'}
              </span>
              {state.result === 'correct'
                ? `Correct! You solved it in ${state.attempts} ${state.attempts === 1 ? 'attempt' : 'attempts'}.`
                : `Not quite. Attempts so far: ${state.attempts}. Try again!`}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pane-footer">
          <div className="flex gap-3">
            <button className="btn-lg btn-sky flex-1">Skip ⟳</button>
            <button className="btn-lg btn-indigo flex-1" onClick={() => setCreating(true)}>
              Create a challenge ✎
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
