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
    return a.length > 0 && filled.length >= 4 && filled.every((w) => w.includes(a));
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
    if (filled.length < 4) {
      setError('Please provide at least 4 words.');
      return;
    }
    if (!filled.every((w) => w.includes(a))) {
      setError('All words must contain the anchor substring.');
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
    <div className="theme-reddit p-4 md:p-6 max-w-2xl mx-auto">
      <div className="cc-box p-4 md:p-6">
        <div className="accent-bar mb-3" />
        <div className="flex items-start gap-3">
          <div className="rdt-title">Anchor Word</div>
          <div className="ml-auto flex items-center gap-2">
            <div className="rdt-badge" title="Number of attempts so far">
              <span className="dot" /> Attempts: {state.attempts}
            </div>
            <div className="muted" role="img" aria-label="help">?</div>
          </div>
        </div>

        <p className="mt-3 muted">Guess the hidden anchor substring shared by all the words below.</p>

        <div className="mt-3 rdt-panel p-3">
          {state.loading ? (
            <div>Loading…</div>
          ) : state.hasChallenge ? (
            <ul className="list-disc list-inside">
              {state.clues.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <div>No challenge found for this post. Use "Create a challenge" to get started.</div>
          )}
        </div>

        {/* Guess input */}
        <div className="mt-4 flex items-center gap-3">
          <input
            aria-label="Type your guess"
            placeholder="Type your guess"
            className="flex-1 rdt-input"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={!canGuess}
          />
          <button
            className="btn btn-primary"
            disabled={!canGuess}
            onClick={submitGuess}
          >
            Guess
          </button>
        </div>

        {state.result !== 'idle' && (
          <div
            className={`mt-2 text-sm result-pop ${state.result === 'correct' ? 'result-correct' : 'result-wrong'}`}
          >
            {state.result === 'correct' ? 'Correct! 🎉' : 'Not quite. Try again!'} (Attempts: {state.attempts})
          </div>
        )}

        {/* Attempts progress */}
        <div className="mt-3 rdt-progress" aria-hidden>
          <div
            className="rdt-progress-bar"
            style={{ width: `${Math.min(100, Math.max(0, state.attempts * 16))}%` }}
          />
        </div>

        <div className="mt-4 flex gap-3">
          <button className="btn btn-secondary">Skip</button>
          <button
            className="btn btn-primary"
            onClick={() => setCreating(true)}
          >
            Create a challenge
          </button>
        </div>
      </div>
    </div>
  );
};
