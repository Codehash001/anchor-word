import { useMemo, useState, useEffect } from 'react';
import { useAnchorWord } from './hooks/useAnchorWord';
import { navigateTo } from '@devvit/web/client';

export const App = () => {
  const { state, guess, setGuess, createChallenge, submitGuess, canGuess, isSubmitting } = useAnchorWord();
  const [creating, setCreating] = useState(false);
  const [screen, setScreen] = useState<'game' | 'leaderboard' | 'challenges'>('game');
  // Create screen state
  const [anchor, setAnchor] = useState('');
  const [words, setWords] = useState<string[]>(['', '', '', '', '', '']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [nextMsg, setNextMsg] = useState<string>('');
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [myChallenges, setMyChallenges] = useState<any[]>([]);
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState<any>(null);
  const [showResults, setShowResults] = useState(false);
  const [challengeResults, setChallengeResults] = useState<any>(null);
  const [showWinnerResults, setShowWinnerResults] = useState(false);

  // Fetch user's challenges
  const fetchMyChallenges = async () => {
    setLoadingChallenges(true);
    try {
      const res = await fetch('/api/anchor/my-challenges');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMyChallenges(data.challenges || []);
    } catch (e) {
      console.error('Failed to fetch challenges', e);
      setError('Failed to load your challenges');
    } finally {
      setLoadingChallenges(false);
    }
  };


  // Auto-dismiss error messages after 5 seconds.
  // Also depend on attempts so each new wrong guess re-triggers the banner.
  useEffect(() => {
    if (state.result === 'incorrect' && !state.hasSolved) {
      setShowError(true);
      const timer = setTimeout(() => {
        setShowError(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [state.result, state.hasSolved, state.attempts]);

  // Show error when result changes to incorrect; include attempts to retrigger.
  useEffect(() => {
    if (state.result === 'incorrect' && !state.hasSolved) {
      setShowError(true);
    }
  }, [state.result, state.hasSolved, state.attempts]);

  const canSubmitCreate = useMemo(() => {
    const a = anchor.trim();
    const filled = words.map((w) => w.trim()).filter(Boolean);
    const okCount = filled.length >= 4 && filled.length <= 6;
    const okPattern = a.length > 0 && filled.every((w) => (w.startsWith(a) || w.endsWith(a)) && w.length > a.length);
    
    // Check for duplicates
    const duplicates = filled.filter((word, index) => filled.indexOf(word) !== index);
    const noDuplicates = duplicates.length === 0;
    
    return okCount && okPattern && noDuplicates;
  }, [anchor, words]);

  const onChangeWord = (i: number, value: string) => {
    const lowercaseValue = value.toLowerCase();
    setWords((arr) => {
      const newArr = arr.map((w, idx) => (idx === i ? lowercaseValue : w));
      
      // Check for duplicates
      const filled = newArr.filter(Boolean);
      const duplicates = filled.filter((word, index) => filled.indexOf(word) !== index);
      
      if (duplicates.length > 0) {
        setError(`Duplicate words not allowed: ${duplicates.join(', ')}`);
      } else {
        setError(''); // Clear error if no duplicates
      }
      
      return newArr;
    });
  };

  const [createMsg, setCreateMsg] = useState<string>('');
  const [navigateUrl, setNavigateUrl] = useState<string | null>(null);
  const onCreate = async () => {
    setError('');
    setCreateMsg('');
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
      const res = await createChallenge(a, filled);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      if (res.navigateTo) {
        const url = res.navigateTo;
        console.log('Received navigateTo URL:', url); // Debug log
        setNavigateUrl(url);
        // Do not auto-navigate due to Reddit CSP in webviews. Show an explicit link/button instead.
        setCreateMsg('Challenge created!');
      } else {
        // If server did not provide a URL, show a generic success and remain on page.
        setCreateMsg('Challenge created!');
      }
    } finally {
      setSaving(false);
    }
  };

  // Dedicated screen: either gameplay or create mode
  // Leaderboard state
  const [lbLoading, setLbLoading] = useState(false);
  const [lbTop, setLbTop] = useState<Array<{ username: string; score: number; rank: number }>>([]);
  const [lbMe, setLbMe] = useState<{ username: string; score: number; rank: number } | null>(null);
  const [lbError, setLbError] = useState<string>('');
  const [lbIcons, setLbIcons] = useState<Record<string, string>>({});

  const openLeaderboard = async () => {
    setScreen('leaderboard');
    setLbError('');
    setLbLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      setLbTop((data.top as any[]).slice(0, 10));
      setLbMe(data.me ?? null);

      // Fetch Reddit avatars for visible users (top 10 + me if outside top)
      try {
        const usernames: string[] = [
          ...(data.top as any[]).slice(0, 10).map((r: any) => r.username),
          ...(data.me && (data.me as any).username ? [data.me.username] : []),
        ];
        const uniq = Array.from(new Set(usernames));
        if (uniq.length > 0) {
          const iconRes = await fetch(`/api/user-icons?users=${encodeURIComponent(uniq.join(','))}`);
          if (iconRes.ok) {
            const iconMap = await iconRes.json();
            setLbIcons(iconMap || {});
          }
        }
      } catch (e) {
        // Non-blocking; ignore avatar errors
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLbError(`Failed to load leaderboard: ${msg}`);
      console.error('Failed to load leaderboard', e);
    } finally {
      setLbLoading(false);
    }
  };

  const findAnotherChallenge = async () => {
    setIsLoadingNext(true);
    setNextMsg('');
    try {
      const res = await fetch('/api/anchor/find-another');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.navigateTo) {
        // Use navigateTo to go to the challenge
        navigateTo(data.navigateTo);
      } else {
        setNextMsg('No other challenges found right now.');
      }
    } catch (e) {
      setNextMsg('Could not find another challenge.');
      console.error(e);
    } finally {
      setIsLoadingNext(false);
    }
  };

  const fetchChallengeResults = async () => {
    try {
      const res = await fetch('/api/anchor/results');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChallengeResults(data);
      setShowWinnerResults(true);
    } catch (e) {
      console.error('Failed to fetch challenge results', e);
      setError('Failed to load results');
    }
  };

  if (screen === 'leaderboard') {
    return (
      <div className="theme-reddit fullpane mx-auto">
        <div className="cc-box p-5 md:p-7">
          <div className="cc-header mb-2">
            <button className="cc-back" onClick={() => setScreen('game')} aria-label="Back">←</button>
            <div className="cc-title">Leaderboard</div>
            <div className="ml-auto muted" title="Top players">🏆</div>
          </div>
          <p className="cc-subtitle">Top 10 players worldwide. Your place is highlighted.</p>
          {lbLoading ? (
            <div className="loading-container">
              <div className="spinner" aria-label="Loading leaderboard"></div>
              <div className="loading-text">Loading leaderboard...</div>
            </div>
          ) : lbError ? (
            <div className="status-banner status-error">
              <span className="status-emoji" role="img" aria-label="error">⚠️</span>
              {lbError}
            </div>
          ) : (
            <div className="lb-list">
              {lbTop.map((row) => {
                const me = lbMe && row.username === lbMe.username;
                const initials = row.username.slice(0, 2).toUpperCase();
                const avatarUrl: string | undefined = lbIcons[row.username];
                return (
                  <div key={row.rank + row.username} className={`lb-row ${me ? 'lb-me' : ''}`}>
                    <div className="lb-rank">{row.rank}</div>
                    <div className="lb-user">
                      {avatarUrl ? (
                        <div className="lb-avatar-wrap" aria-hidden>
                          <img className="lb-avatar-img" src={avatarUrl} alt="" />
                          <div className="lb-avatar-fallback" aria-hidden>{initials}</div>
                        </div>
                      ) : (
                        <div className="lb-avatar" aria-hidden>{initials}</div>
                      )}
                      <span>{me ? 'You' : row.username}</span>
                    </div>
                    <div className="lb-score">{row.score}</div>
                  </div>
                );
              })}
              {lbMe && lbMe.rank > 10 && (
                <>
                  <div className="lb-separator">
                    <div className="lb-separator-line"></div>
                    <span className="lb-separator-text">Your Position</span>
                    <div className="lb-separator-line"></div>
                  </div>
                  <div className="lb-row lb-me">
                    <div className="lb-rank">{lbMe.rank}</div>
                    <div className="lb-user">
                      {lbIcons[lbMe.username] ? (
                        <div className="lb-avatar-wrap" aria-hidden>
                          <img className="lb-avatar-img" src={lbIcons[lbMe.username]} alt="" />
                          <div className="lb-avatar-fallback">{lbMe.username.slice(0,2).toUpperCase()}</div>
                        </div>
                      ) : (
                        <div className="lb-avatar" aria-hidden>{lbMe.username.slice(0,2).toUpperCase()}</div>
                      )}
                      <span>You</span>
                      <span className="lb-username-muted">@{lbMe.username}</span>
                    </div>
                    <div className="lb-score">{lbMe.score}</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* If the current user is the creator, show CTA to view results instead of guessing */}
          {!state.hasSolved && state.isCreator && (
            <div className="status-banner status-neutral">
              <span className="status-emoji" role="img" aria-label="info">ℹ️</span>
              This is your challenge. You can view participants and results.
              <button
                className="bg-white z-30 text-green-700 hover:bg-green-50 px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ml-3 border border-green-200 cursor-pointer"
                onClick={fetchChallengeResults}
                aria-label="Show challenge results"
              >
                Show Results
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'challenges') {
    return (
      <div className="theme-reddit fullpane mx-auto">
        <div className="cc-box p-5 md:p-7">
          <div className="cc-header mb-4">
            <button className="cc-back" onClick={() => setScreen('game')} aria-label="Back">←</button>
            <div className="cc-title">My Challenges</div>
            <div className="ml-auto flex items-center gap-2">
              {selectedChallenge && (
                <button 
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium cursor-pointer px-2 py-1 rounded hover:bg-blue-50"
                  onClick={() => setSelectedChallenge(null)}
                >
                  ← Back to List
                </button>
              )}
              <div className="muted" title="Your created challenges">📝</div>
            </div>
          </div>
          
          {loadingChallenges ? (
            <div className="loading-container">
              <div className="spinner" aria-label="Loading challenges"></div>
              <div className="loading-text">Loading your challenges...</div>
            </div>
          ) : myChallenges.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-4xl">📝</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">No challenges yet</h3>
              <p className="text-gray-600 mb-6">Create your first challenge to start tracking performance!</p>
              <button
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg"
                onClick={() => setScreen('game')}
              >
                Create Challenge
              </button>
            </div>
          ) : selectedChallenge ? (
            <div className="flex flex-col h-full">
              {/* Challenge Details View */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col h-full">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800 mb-1">{selectedChallenge.title}</h3>
                    <p className="text-sm text-gray-500">Created {new Date(selectedChallenge.created).toLocaleDateString()}</p>
                  </div>
                  <button
                    className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-md"
                    onClick={() => navigateTo(selectedChallenge.url)}
                  >
                    View Post
                  </button>
                </div>
                
                {/* Answers Section - Full Height */}
                {selectedChallenge.answers && selectedChallenge.answers.length > 0 && (
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600 text-sm">💭</span>
                        <span className="text-sm font-semibold text-gray-800">Results</span>
                        <span className="text-xs text-gray-500">({selectedChallenge.answers.length})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full text-xs font-medium">
                          ✅ {selectedChallenge.totalSolvers} solvers
                        </div>
                        <div className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                          🎯 {selectedChallenge.totalAttempts} attempts
                        </div>
                      </div>
                    </div>
                    
                    {/* Scrollable answers container - Uses remaining space */}
                    <div className="flex-1 overflow-y-auto min-h-0">
                      {/* Aggregate answers by answer text */}
                      {(() => {
                        const answerCounts: { [key: string]: { count: number; isCorrect: boolean; attempts: number[] } } = {};
                        
                        selectedChallenge.answers.forEach((answer: any) => {
                          if (!answerCounts[answer.answer]) {
                            answerCounts[answer.answer] = {
                              count: 0,
                              isCorrect: answer.isCorrect,
                              attempts: []
                            };
                          }
                          const answerData = answerCounts[answer.answer];
                          if (answerData) {
                            answerData.count++;
                            answerData.attempts.push(answer.attempt);
                          }
                        });
                        
                        const sortedAnswers = Object.entries(answerCounts)
                          .sort(([,a], [,b]) => b.count - a.count);
                        
                        const maxCount = Math.max(...sortedAnswers.map(([,data]) => data.count));
                        
                        return (
                          <div className="space-y-1">
                            {sortedAnswers.map(([answerText, data], index) => (
                              <div key={answerText} className="relative">
                                <div className={`flex items-center justify-between p-2 rounded border ${
                                  data.isCorrect 
                                    ? 'bg-green-50 border-green-200' 
                                    : 'bg-red-50 border-red-200'
                                }`}>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                      data.isCorrect 
                                        ? 'bg-green-500 text-white' 
                                        : 'bg-red-500 text-white'
                                    }`}>
                                      {index + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1">
                                        <span className={`text-sm font-semibold truncate ${
                                          data.isCorrect ? 'text-green-800' : 'text-red-800'
                                        }`}>
                                          "{answerText}"
                                        </span>
                                        {data.isCorrect && (
                                          <span className="text-green-600 text-xs">✅</span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-600">
                                        {data.count} {data.count === 1 ? 'guess' : 'guesses'}
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {/* Progress bar */}
                                  <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden mx-1 flex-shrink-0">
                                    <div 
                                      className={`h-full transition-all duration-500 ${
                                        data.isCorrect ? 'bg-green-500' : 'bg-red-500'
                                      }`}
                                      style={{ width: `${(data.count / maxCount) * 100}%` }}
                                    />
                                  </div>
                                  
                                  <div className="text-right flex-shrink-0">
                                    <div className={`text-sm font-bold ${
                                      data.isCorrect ? 'text-green-800' : 'text-red-800'
                                    }`}>
                                      {data.count}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {Math.round((data.count / selectedChallenge.answers.length) * 100)}%
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Challenges List View */}
              {myChallenges.map((challenge, index) => (
                <div key={challenge.postId} className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-800 mb-1">{challenge.title}</h3>
                      <p className="text-sm text-gray-500">Created {new Date(challenge.created).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                        onClick={() => setSelectedChallenge(challenge)}
                      >
                        View Results
                      </button>
                      <button
                        className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-md"
                        onClick={() => navigateTo(challenge.url)}
                      >
                        View Post
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showResults && challengeResults) {
    return (
      <div className="theme-reddit fullpane mx-auto">
        <div className="cc-box p-5 md:p-7">
          <div className="cc-header mb-4">
            <button className="cc-back" onClick={() => setShowResults(false)} aria-label="Back">←</button>
            <div className="cc-title">Challenge Results</div>
            <div className="ml-auto muted" title="Challenge statistics">📊</div>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            {/* Challenge Info */}
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Anchor Word Challenge</h3>
              <p className="text-sm text-gray-500">Challenge Results</p>
            </div>
            
            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-blue-800">{challengeResults.totalAttempts}</div>
                <div className="text-sm text-blue-600 font-medium">Attempts</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-800">{challengeResults.totalSolvers}</div>
                <div className="text-sm text-green-600 font-medium">Solved</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-purple-800">{challengeResults.answers?.length || 0}</div>
                <div className="text-sm text-purple-600 font-medium">Guesses</div>
              </div>
            </div>
            
            {/* Answer Bars */}
            {challengeResults.answers && challengeResults.answers.length > 0 && (
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-4 text-center">Answer Distribution</h4>
                <div className="space-y-3">
                  {(() => {
                    const answerCounts: { [key: string]: { count: number; isCorrect: boolean } } = {};
                    
                    challengeResults.answers.forEach((answer: any) => {
                      if (!answerCounts[answer.answer]) {
                        answerCounts[answer.answer] = {
                          count: 0,
                          isCorrect: answer.isCorrect
                        };
                      }
                      const answerData = answerCounts[answer.answer];
                      if (answerData) {
                        answerData.count++;
                      }
                    });
                    
                    const sortedAnswers = Object.entries(answerCounts)
                      .sort(([,a], [,b]) => b.count - a.count);
                    
                    const maxCount = Math.max(...sortedAnswers.map(([,data]) => data.count));
                    
                    return sortedAnswers.map(([answerText, data], index) => (
                      <div key={answerText} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className={`font-medium ${data.isCorrect ? 'text-green-800' : 'text-red-800'}`}>
                            "{answerText}"
                          </span>
                          <span className="text-gray-600">{data.count} guesses</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div 
                            className={`h-3 rounded-full transition-all duration-500 ${
                              data.isCorrect ? 'bg-green-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${(data.count / maxCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Winner Results Screen - Same detailed layout as My Challenges
  if (showWinnerResults && challengeResults) {
    return (
      <div className="theme-reddit fullpane mx-auto">
        <div className="cc-box p-5 md:p-7">
          <div className="cc-header mb-4">
            <button className="cc-back" onClick={() => setShowWinnerResults(false)} aria-label="Back">←</button>
            <div className="cc-title">Challenge Results</div>
          </div>
          
          <div className="flex flex-col h-full">
            {/* Challenge Details View */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col h-full">
              
              {/* Answers Section - Full Height */}
              {challengeResults.answers && challengeResults.answers.length > 0 && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-600 text-sm">💭</span>
                      <span className="text-sm font-semibold text-gray-800">Results</span>
                      <span className="text-xs text-gray-500">({challengeResults.answers.length})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full text-xs font-medium">
                        ✅ {challengeResults.totalSolvers} solvers
                      </div>
                      <div className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                        🎯 {challengeResults.totalAttempts} attempts
                      </div>
                    </div>
                  </div>
                  
                  {/* Scrollable answers container - Uses remaining space */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {/* Aggregate answers by answer text */}
                    {(() => {
                      const answerCounts: { [key: string]: { count: number; isCorrect: boolean; attempts: number[] } } = {};
                      
                      challengeResults.answers.forEach((answer: any) => {
                        if (!answerCounts[answer.answer]) {
                          answerCounts[answer.answer] = {
                            count: 0,
                            isCorrect: answer.isCorrect,
                            attempts: []
                          };
                        }
                        const answerData = answerCounts[answer.answer];
                        if (answerData) {
                          answerData.count++;
                          answerData.attempts.push(answer.attempt);
                        }
                      });
                      
                      const sortedAnswers = Object.entries(answerCounts)
                        .sort(([,a], [,b]) => b.count - a.count);
                      
                      const maxCount = Math.max(...sortedAnswers.map(([,data]) => data.count));
                      
                      return (
                        <div className="space-y-1">
                          {sortedAnswers.map(([answerText, data], index) => (
                            <div key={answerText} className="relative">
                              <div className={`flex items-center justify-between p-2 rounded border ${
                                data.isCorrect 
                                  ? 'bg-green-50 border-green-200' 
                                  : 'bg-red-50 border-red-200'
                              }`}>
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                    data.isCorrect 
                                      ? 'bg-green-500 text-white' 
                                      : 'bg-red-500 text-white'
                                  }`}>
                                    {index + 1}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <span className={`text-sm font-semibold truncate ${
                                        data.isCorrect ? 'text-green-800' : 'text-red-800'
                                      }`}>
                                        "{answerText}"
                                      </span>
                                      {data.isCorrect && (
                                        <span className="text-green-600 text-xs">✅</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      {data.count} {data.count === 1 ? 'guess' : 'guesses'}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Progress bar */}
                                <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden mx-1 flex-shrink-0">
                                  <div 
                                    className={`h-full transition-all duration-500 ${
                                      data.isCorrect ? 'bg-green-500' : 'bg-red-500'
                                    }`}
                                    style={{ width: `${(data.count / maxCount) * 100}%` }}
                                  />
                                </div>
                                
                                <div className="text-right flex-shrink-0">
                                  <div className={`text-sm font-bold ${
                                    data.isCorrect ? 'text-green-800' : 'text-red-800'
                                  }`}>
                                    {data.count}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {Math.round((data.count / challengeResults.answers.length) * 100)}%
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="theme-reddit fullpane mx-auto">
        <div className="cc-box p-3 mx-auto">
          <div className="cc-header mb-3">
            <button className="cc-back" onClick={() => setCreating(false)} aria-label="Back">←</button>
            <div className="cc-title">Create Challenge</div>
            <div className="flex items-center gap-2 ml-auto">
              <button 
                className="text-blue-600 hover:text-blue-800 text-sm font-medium cursor-pointer px-2 py-1 rounded hover:bg-blue-50"
                onClick={() => {
                  setScreen('challenges');
                  fetchMyChallenges();
                }}
                title="My Challenges"
                aria-label="Show my challenges"
              >
                📝 My Challenges
              </button>

            </div>
          </div>
          
          <div className="space-y-2">
            <div>
              <p className="cc-subtitle mb-1">1) Enter the anchor word substring</p>
            <input
              className="anchor-input"
              value={anchor}
                onChange={(e) => setAnchor(e.target.value.toLowerCase())}
              placeholder="Type the anchor substring (e.g., 'bed')"
            />
          </div>

            <div>
              <p className="cc-subtitle mb-1">2) Enter 4–6 words that share the same anchor</p>
          <div className="words-grid">
            {words.map((w, i) => (
              <input
                key={`word-${i}`}
                className="word-input"
                value={w}
                onChange={(e) => onChangeWord(i, e.target.value)}
                placeholder={`Word ${i + 1}`}
              />
            ))}
              </div>
          </div>

          {/* Tip: encourage mixing prefix and suffix examples */}
            <div className="tip-box">
              <span className="badge">Tip</span>
              <span>
                Mix both prefix and suffix examples for better gameplay. If your anchor is
                <strong> "bed"</strong>, include words like <strong>bedrock</strong> (prefix) and
                <strong> seabed</strong> (suffix). Shuffle them so the pattern isn't obvious!
              </span>
            </div>

            {/* Action area - status left, button right */}
            <div className="flex items-center justify-between gap-3">
              {/* Status messages on the left */}
              <div className="flex-1 min-w-0">
                {saving && (
                  <div className="flex items-center gap-2">
                    <span className="spinner" aria-label="Creating" />
                    <span className="text-sm text-gray-600">Creating challenge...</span>
                  </div>
                )}
                {error && !saving && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <span>❌</span>
                    <span className="flex-1">{error}</span>
                  </div>
                )}
                {createMsg && !saving && !error && (
                  <div className="text-sm text-green-600 font-medium">
                    ✅ {createMsg}
                  </div>
                )}
          </div>

              {/* Button on the right */}
              <div className="flex-shrink-0">
                {navigateUrl && !saving ? (
                  <div className="flex items-center gap-2">
                    <button 
                      className="btn-lg btn-sky"
                      onClick={() => {
                        // Clean the URL by removing any @ symbols and ensuring it's a valid URL
                        let cleanUrl = navigateUrl.trim();
                        if (cleanUrl.startsWith('@')) {
                          cleanUrl = cleanUrl.substring(1);
                        }
                        // Ensure it starts with https://
                        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
                          cleanUrl = 'https://' + cleanUrl;
                        }
                        
                        console.log('Navigating to URL:', cleanUrl); // Debug log
                        
                        // Use Devvit's navigateTo function for proper Reddit webview navigation
                        try {
                          navigateTo(cleanUrl);
                        } catch (e) {
                          console.error('Failed to navigate with navigateTo:', e);
                          // Fallback: copy URL to clipboard
                          navigator.clipboard.writeText(cleanUrl).then(() => {
                            alert('URL copied to clipboard! Please paste it in a new tab.');
                          }).catch(() => {
                            alert(`Please copy this URL and open it in a new tab:\n${cleanUrl}`);
                          });
                        }
                      }}
                    >
                      <span className="text-lg">👀</span>
                      View Post
                    </button>
                  </div>
                ) : (
                  <button 
                    className="btn-lg btn-indigo" 
                    onClick={onCreate} 
                    disabled={saving || !canSubmitCreate}
                  >
                    <span className="text-lg">🚀</span>
                    Create Challenge
            </button>
            )}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="theme-reddit fullpane mx-auto">
      <div className="cc-box p-5 md:p-7">
        <div className="pane-content">
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              {/* App logo before title */}
              <img src="/aw-logo-new.png" alt="Anchor Word" width={56} height={56} style={{ borderRadius: 10 }} />
              <div className="rdt-title">Anchor Word</div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="attempts-pill" title="Number of attempts so far">
                  <span className="font-semibold">Attempts:</span> {state.attempts}
                </div>
                {/* Progress indicator - 3 dots only */}
                <div className="flex gap-1">
                  {[1, 2, 3].map((attempt) => (
                    <div
                      key={attempt}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        attempt <= state.attempts
                          ? 'bg-red-400'
                          : attempt === state.attempts + 1
                          ? 'bg-yellow-300 animate-pulse'
                          : 'bg-gray-200'
                      }`}
                      title={`Attempt ${attempt}`}
                    />
                  ))}
                </div>
              </div>
              <button 
                className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold text-lg flex items-center justify-center transition-all duration-200 shadow-md hover:shadow-lg transform hover:cursor-pointer"
                role="button" 
                aria-label="Help"
                title="Click for help"
                onClick={() => setShowHelp(true)}
              >
                ?
              </button>
            </div>
          </div>

          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="text-slate-700 font-medium text-sm leading-tight">
                Find the <strong className="text-blue-600">anchor substring</strong> that appears in all words below.<br/> 
                The anchor may be placed at either the <strong className="text-blue-600">start</strong> or the <strong className="text-blue-600">end</strong> of the words.
              </p>
              {/* Game state indicator */}
              <div className="flex items-center gap-2 ml-3">
                {state.hasSolved ? (
                  <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                    <span>🎉</span>
                    Solved!
                  </div>
                ) : state.hasChallenge ? (
                  <div className="flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">
                    <span>🤔</span>
                    In Progress
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                    <span>⏳</span>
                    No Challenge
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Clue chips / Reveal chips */}
          <div className="chip-grid mt-2" role="region" aria-label="Game words">
            {state.loading ? (
              <div className="w-screen flex items-center justify-center">
                <div className="flex flex-col items-center">
                  <div className="spinner" aria-label="Loading game"></div>
                  <div className="loading-text">Loading challenge...</div>
                </div>
              </div>
            ) : state.hasChallenge ? (
              state.hasSolved && state.words && state.anchor ? (
                state.words.map((w, i) => {
                  const a = state.anchor as string;
                  const isPrefix = w.startsWith(a);
                  const left = isPrefix ? a : w.slice(0, w.length - a.length);
                  const right = isPrefix ? w.slice(a.length) : a;
                  return (
                    <div 
                      key={i} 
                      className="chip-reveal"
                      role="text"
                      aria-label={`Word ${i + 1}: ${w}, with anchor "${a}" at the ${isPrefix ? 'beginning' : 'end'}`}
                    >
                      {isPrefix ? (
                        <>
                          <span className="anchor" aria-label={`Anchor: ${left}`}>{left}</span>
                          <span className="rest" aria-label={`Rest: ${right}`}>{right}</span>
                        </>
                      ) : (
                        <>
                          <span className="rest" aria-label={`Rest: ${left}`}>{left}</span>
                          <span className="anchor" aria-label={`Anchor: ${right}`}>{right}</span>
                        </>
                      )}
                    </div>
                  );
                })
              ) : (
                state.clues.map((c, i) => (
                  <div 
                    key={i} 
                    className="chip"
                    role="text"
                    aria-label={`Clue word ${i + 1}: ${c}`}
                  >
                    <span className="text">{c}</span>
                  </div>
                ))
              )
            ) : (
              <div className="cc-muted">No challenge found for this post. Use "Create a challenge" to get started.</div>
            )}
          </div>

          {/* Guess input - Only show when not solved and not the creator */}
          {!state.hasSolved && !state.isCreator && (
            <div className="guess-row mt-4">
              <input
                aria-label="Type your guess"
                placeholder="Type your guess"
                className="guess-input"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canGuess && !isSubmitting) {
                    e.preventDefault();
                    submitGuess();
                  }
                }}
                disabled={!canGuess || isSubmitting}
              />
              <button 
                className={`guess-btn ${isSubmitting ? 'opacity-80 cursor-not-allowed' : ''}`} 
                disabled={!canGuess || isSubmitting} 
                onClick={submitGuess} 
                title={isSubmitting ? 'Submitting…' : 'Submit your guess (Enter)'}
                aria-label="Submit your guess"
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <span className="mr-2">🤔</span>
                    Guess
                  </>
                )}
              </button>
            </div>
          )}

          {/* Inline status banner below input */}
          {(state.hasSolved || (state.result !== 'idle' && showError)) && (
            <div className={`status-banner ${state.hasSolved ? 'status-success' : 'status-error'} ${!state.hasSolved ? 'dismissible' : ''}`}>
              <span className="status-emoji" role="img" aria-label={state.hasSolved ? 'success' : 'error'}>
                {state.hasSolved ? '🎉' : '❌'}
              </span>
              <div className="flex-1">
              {state.hasSolved
                ? (() => {
                    const award = typeof state.lastScoreAward === 'number'
                      ? state.lastScoreAward
                      : (state.attempts === 1 ? 20 : state.attempts === 2 ? 15 : state.attempts === 3 ? 10 : 5);
                    return `You solved this in ${state.attempts} ${state.attempts === 1 ? 'attempt' : 'attempts'} and gained +${award} anchor points!`;
                  })()
                : `Not quite. Attempts so far: ${state.attempts}. Try again!`}
              </div>
              {state.hasSolved && (
                <button
                  className="bg-white z-30 text-green-700 hover:bg-green-50 px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ml-3 border border-green-200 cursor-pointer"
                  onClick={fetchChallengeResults}
                  aria-label="Show challenge results"
                >
                  Show Results
                </button>
              )}
              {!state.hasSolved && (
                <button
                  className="dismiss-btn"
                  onClick={() => setShowError(false)}
                  aria-label="Dismiss error message"
                  title="Dismiss (or wait 5 seconds)"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pane-footer">
          <div className="flex gap-3">
            <button
              className="btn-lg btn-sky flex-1"
              onClick={findAnotherChallenge}
              disabled={isLoadingNext}
              aria-label="Find another challenge"
            >
              {isLoadingNext ? (
                <>
                  <span className="spinner" aria-label="Loading next challenge" />
                  Loading...
                </>
              ) : (
                <>
                  <span className="text-lg">🔍</span>
                  Find Another
                </>
              )}
            </button>
            <button 
              className="btn-lg btn-sky flex-1" 
              onClick={openLeaderboard}
              aria-label="View leaderboard"
            >
              <span className="text-lg">🏆</span>
              Leaderboard
            </button>
            <button 
              className="btn-lg btn-indigo flex-1" 
              onClick={() => setCreating(true)}
              aria-label="Create a new challenge"
            >
              <span className="text-lg">✏️</span>
              Create Challenge
            </button>
          </div>
          {(nextUrl || nextMsg) && (
            <div className="actions-right mt-2">
              <span className={`status-inline ${nextUrl ? 'success' : 'error'}`}>{nextMsg}</span>
              {nextUrl && (
                <a className="btn-lg btn-sky" href={nextUrl} target="_blank" rel="noopener noreferrer">Open next ↗</a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <div className="help-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-modal-header">
              <div className="help-modal-title">
                <span>🎮</span>
                How to Play Anchor Word
              </div>
              <button
                className="help-modal-close"
                onClick={() => setShowHelp(false)}
                aria-label="Close help modal"
              >
                ×
              </button>
            </div>
            
            <div className="help-modal-content">
              <div className="help-modal-section">
                <h3>🎯 Objective</h3>
                <p>Find the <strong>anchor substring</strong> that appears in all the given words. The anchor can be at the beginning or end of each word, and both the anchor and the remaining parts must be valid English words.</p>
              </div>

              <div className="help-modal-section">
                <h3>📝 How to Play</h3>
                <p>1. Look at the 4-6 clue words provided</p>
                <p>2. Find the common substring that appears in all words</p>
                <p>3. Type your guess in the input field</p>
                <p>4. Click "Guess" or press Enter to submit</p>
                <p>5. You have unlimited attempts to solve each puzzle</p>
              </div>

              <div className="help-modal-example">
                <h4>Valid Example:</h4>
                <p>Words: <strong>bedroom</strong>, <strong>bedsheet</strong>, <strong>bedrock</strong>, <strong>seabed</strong>, <strong>flowerbed</strong></p>
                <p>Answer: <strong>"bed"</strong></p>
                <p>✅ <strong>bed</strong> + <strong>room</strong> = bedroom (both valid words)</p>
                <p>✅ <strong>bed</strong> + <strong>sheet</strong> = bedsheet (both valid words)</p>
                <p>✅ <strong>sea</strong> + <strong>bed</strong> = seabed (both valid words)</p>
              </div>

              <div className="help-modal-example">
                <h4>Invalid Example:</h4>
                <p>❌ <strong>bedazzle</strong> - "azzle" is not a valid English word</p>
                <p>❌ <strong>bedphone</strong> - "phone" is valid, but "bed" + "phone" doesn't make sense</p>
              </div>

              <div className="help-modal-section">
                <h3>🏆 Scoring System</h3>
                <div className="help-modal-points">
                  <h4>🎯 Anchor Points (only for correct answers)</h4>
                  <p>• <strong>1st attempt:</strong> +20 points</p>
                  <p>• <strong>2nd attempt:</strong> +15 points</p>
                  <p>• <strong>3rd attempt:</strong> +10 points</p>
                  <p>• <strong>4th+ attempts:</strong> +5 points</p>
                  <p>• <strong>No correct answer:</strong> 0 points</p>
                </div>
              </div>

              <div className="help-modal-section">
                <h3>📊 Leaderboard</h3>
                <p>Compete with other players worldwide! Your total anchor points are tracked and displayed on the leaderboard. The more puzzles you solve, the higher you climb!</p>
              </div>

              <div className="help-modal-section">
                <h3>✨ Tips</h3>       
                <p>• The anchor is usually 2-4 letters long (maybe longer)</p>
                <p>• Try different positions - it could be at the start OR end</p>
                <p>• Both the anchor and remaining parts must be valid English words</p>
                <p>• Use the "Find Another" button if you're stuck on a puzzle</p>
                <p>• Create your own challenges with 4-6 words to share with others!</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
