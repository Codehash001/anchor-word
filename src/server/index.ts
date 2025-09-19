import express from 'express';
import {
  InitResponse,
  IncrementResponse,
  DecrementResponse,
  AnchorInitResponse,
  AnchorCreateResponse,
  AnchorGuessResponse,
  AnchorPostData,
} from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
// Use a bundle-safe dictionary that inlines words as an array
import englishWords from 'an-array-of-english-words';

// Simple dictionary loader (English word list)
let DICT: Set<string> | null = null;
async function getDict(): Promise<Set<string>> {
  if (DICT) return DICT;
  const words: string[] = (englishWords as unknown as string[]) ?? [];
  DICT = new Set<string>(words.map((w) => w.toLowerCase()));
  return DICT;
}

function isAlpha(s: string): boolean {
  return /^[a-zA-Z]+$/.test(s);
}

function stripAnchorFromWord(anchor: string, word: string): string | null {
  if (word.startsWith(anchor)) return word.slice(anchor.length);
  if (word.endsWith(anchor)) return word.slice(0, word.length - anchor.length);
  return null;
}
import { createPost } from './core/post';

const app = express();

// Middleware for JSON body parsing
app.use(express.json());
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      console.error('API Init Error: postId not found in devvit context');
      res.status(400).json({
        status: 'error',
        message: 'postId is required but missing from context',
      });
      return;
    }
    try {
      const [count, username] = await Promise.all([
        redis.get('count'),
        reddit.getCurrentUsername(),
      ]);
      res.json({
        type: 'init',
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? 'anonymous',
      });
    } catch (error) {
      console.error(`API Init Error for post ${postId}:`, error);
      let errorMessage = 'Unknown error during initialization';
      if (error instanceof Error) {
        errorMessage = `Initialization failed: ${error.message}`;
      }
      res.status(400).json({ status: 'error', message: errorMessage });
    }
  }
);

// Get user's created challenges
router.get('/api/anchor/my-challenges', async (_req, res): Promise<void> => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const userChallengesKey = `anchor:user:challenges:${username}`;
    
    // Get all challenges for this user using hGetAll
    const challengesData = await redis.hGetAll(userChallengesKey);
    
    if (!challengesData || Object.keys(challengesData).length === 0) {
      res.json({ type: 'my_challenges', challenges: [] });
      return;
    }
    
    // Get details for each challenge
    const challenges = await Promise.all(
      Object.entries(challengesData).map(async ([postId, challengeInfo]) => {
        try {
          const info = JSON.parse(challengeInfo);
          
          // Get challenge stats
          const solvedKey = `anchor:user:solved:${postId}:${username}`;
          const attemptsKey = `anchor:user:attempts:${postId}:${username}`;
          const [solved, attempts] = await Promise.all([
            redis.get(solvedKey),
            redis.get(attemptsKey)
          ]);
          
          // Get total attempts by all users
          const totalAttemptsKey = `anchor:total:attempts:${postId}`;
          const totalAttempts = await redis.get(totalAttemptsKey) || '0';
          
          // Get total solvers from hash
          const solversKey = `anchor:solvers:${postId}`;
          const solversData = await redis.hGetAll(solversKey);
          const totalSolvers = Object.keys(solversData).length;
          
          // Get all answers with attempt numbers
          const answersKey = `anchor:answers:${postId}`;
          const answersData = await redis.hGetAll(answersKey);
          const answers = Object.entries(answersData).map(([key, answer]) => {
            const [user, attemptNum] = key.split(':');
            return {
              user: user || '',
              attempt: Number.isNaN(Number(attemptNum)) ? 0 : parseInt(attemptNum || '0', 10),
              answer,
              isCorrect: answer === info.anchor
            };
          }).sort((a, b) => a.attempt - b.attempt);
          
          return {
            postId,
            title: info.title || `Anchor Word Challenge #${postId.slice(-6)}`,
            url: `https://www.reddit.com/r/${context.subredditName}/comments/${postId}/`,
            created: info.created || new Date().toISOString(),
            solved: solved === '1',
            attempts: parseInt(attempts || '0'),
            totalAttempts: parseInt(totalAttempts),
            totalSolvers,
            answers,
            anchor: info.anchor
          };
        } catch (e) {
          console.error(`Error fetching challenge ${postId}:`, e);
          return null;
        }
      })
    );
    
    const validChallenges = challenges.filter(Boolean);
    res.json({ type: 'my_challenges', challenges: validChallenges });
  } catch (e) {
    console.error('My challenges error', e);
    res.status(400).json({ status: 'error', message: 'Failed to load challenges' });
  }
});

// Fetch Reddit user icons (snoovatar/icon) with simple caching
router.get('/api/user-icons', async (req, res): Promise<void> => {
  try {
    const usersParam = (req.query.users ?? '').toString();
    if (!usersParam) {
      res.json({});
      return;
    }
    const usernames = Array.from(new Set(usersParam.split(',').map((u) => u.trim()).filter(Boolean)));

    const cacheKey = 'anchor:user:icons';
    const cached = await redis.hGetAll(cacheKey);

    const result: Record<string, string> = {};
    const toFetch: string[] = [];
    for (const u of usernames) {
      const v = cached?.[u];
      if (v && typeof v === 'string' && v.length > 0) result[u] = v;
      else toFetch.push(u);
    }

    // Fetch missing icons from Reddit public API
    const fetchedPairs: Record<string, string> = {};
    await Promise.all(
      toFetch.map(async (u) => {
        try {
          const resp = await fetch(`https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`, {
            headers: { 'User-Agent': 'anchorword2-avatar-fetch/1.0' },
          });
          if (!resp.ok) return;
          const json = await resp.json();
          const data = (json as any)?.data ?? {};
          const icon: string | undefined = data.snoovatar_img || data.icon_img || '';
          if (icon) {
            fetchedPairs[u] = icon;
            result[u] = icon;
          } else {
            // store empty string to avoid repeated fetches
            fetchedPairs[u] = '';
          }
        } catch (_) {
          // ignore errors per-user
          fetchedPairs[u] = '';
        }
      })
    );

    // Cache what we found
    if (Object.keys(fetchedPairs).length > 0) {
      await redis.hSet(cacheKey, fetchedPairs as any);
    }

    res.json(result);
  } catch (e) {
    console.error('user-icons error', e);
    res.status(400).json({});
  }
});

// Leaderboard: top 10 and current user's rank
router.get('/api/leaderboard', async (_req, res): Promise<void> => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    // Get leaderboard scores using Redis hash
    const all: Record<string, string> = await redis.hGetAll('anchor:leaderboard:scores') || {};
    const arr = Object.entries(all)
      .map(([user, sc]) => ({ username: user, score: parseInt(sc || '0') || 0 }))
      .sort((a, b) => b.score - a.score);
    const top = arr.slice(0, 10).map((e, i) => ({ ...e, rank: i + 1 }));
    const meIndex = arr.findIndex((e) => e.username === username);
    const me = meIndex >= 0 ? { username, score: arr[meIndex]?.score, rank: meIndex + 1 } : { username, score: 0, rank: -1 };
    const payload = { type: 'leaderboard', top, me } as any;
    res.json(payload);
  } catch (e) {
    console.error('Leaderboard error', e);
    res.status(400).json({ status: 'error', message: 'Failed to load leaderboard' });
  }
});

// Anchor: Next unsolved challenge for current user (Skip)
router.get('/api/anchor/next', async (_req, res): Promise<void> => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const members = await (redis as any).sMembers('anchor:posts');
    const postIds: string[] = Array.isArray(members) ? members : [];
    for (const pid of postIds) {
      const attemptsKey = `anchor:user:attempts:${pid}:${username}`;
      const solvedKey = `anchor:user:solved:${pid}:${username}`;
      const [attemptsStr, solvedStr] = await Promise.all([
        redis.get(attemptsKey),
        redis.get(solvedKey),
      ]);
      const attempted = !!attemptsStr;
      const solved = solvedStr === '1';
      if (!attempted || !solved) {
        const url = `https://www.reddit.com/comments/${pid}/`;
        res.json({ type: 'anchor_next', postId: pid, navigateTo: url });
        return;
      }
    }
    res.json({ type: 'anchor_next', postId: null, navigateTo: null });
  } catch (e) {
    console.error('Next challenge error', e);
    res.status(400).json({ status: 'error', message: 'Failed to find next challenge' });
  }
});

// Anchor: Find another challenge (not created by current user)
router.get('/api/anchor/find-another', async (_req, res): Promise<void> => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const subredditName = context.subredditName;
    const currentPostId = context.postId;
    
    if (!subredditName) {
      res.json({ type: 'find_another', navigateTo: null });
      return;
    }
    
    // Get all challenges created by other users
    const allChallengesKey = 'anchor:all:challenges';
    const allChallenges = await redis.hGetAll(allChallengesKey);
    
    // Filter out challenges created by current user and find unsolved ones
    const otherChallenges = Object.entries(allChallenges)
      .filter(([postId, challengeInfo]) => {
        try {
          const info = JSON.parse(challengeInfo);
          // Not created by current user and not the current post we are on
          if (currentPostId && postId === currentPostId) return false;
          return info.creator !== username;
        } catch {
          return false;
        }
      })
      .map(([postId, challengeInfo]) => {
        try {
          const info = JSON.parse(challengeInfo);
          return { postId, ...info };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()); // Sort by newest first
    
    // Find the first unsolved challenge
    for (const challenge of otherChallenges) {
      const solvedKey = `anchor:user:solved:${challenge.postId}:${username}`;
      const isSolved = await redis.get(solvedKey);
      if (isSolved !== '1') {
        const challengeUrl = `https://www.reddit.com/r/${subredditName}/comments/${challenge.postId}/`;
        res.json({ type: 'find_another', navigateTo: challengeUrl });
        return;
      }
    }

    // Fallback: scan the legacy 'anchor:posts' set to find any other unsolved challenge
    try {
      const members = await (redis as any).sMembers('anchor:posts');
      const postIds: string[] = Array.isArray(members) ? members : [];
      // Fetch user's own challenge IDs to exclude
      const userChallengesKey = `anchor:user:challenges:${username}`;
      const myChallenges = await redis.hGetAll(userChallengesKey);
      const myIds = new Set(Object.keys(myChallenges || {}));

      for (const pid of postIds) {
        if (currentPostId && pid === currentPostId) continue; // exclude current
        if (myIds.has(pid)) continue; // exclude own
        const solvedKey = `anchor:user:solved:${pid}:${username}`;
        const isSolved = await redis.get(solvedKey);
        if (isSolved === '1') continue; // skip solved

        const url = `https://www.reddit.com/r/${subredditName}/comments/${pid}/`;
        res.json({ type: 'find_another', navigateTo: url });
        return;
      }
    } catch (e) {
      // ignore fallback errors
    }

    // Second fallback: query subreddit new posts directly and infer challenge posts by title pattern
    try {
      const resp = await fetch(`https://www.reddit.com/r/${subredditName}/new.json?limit=50`, {
        headers: { 'User-Agent': 'anchorword2-find-another/1.0' },
      });
      if (resp.ok) {
        const json = (await resp.json()) as any;
        const children: any[] = json?.data?.children ?? [];
        for (const child of children) {
          const d = child?.data ?? {};
          const pid: string | undefined = d?.id;
          const title: string = d?.title ?? '';
          const author: string = d?.author ?? '';
          if (!pid) continue;
          if (currentPostId && pid === currentPostId) continue; // exclude current
          if (author && author === username) continue; // exclude own
          if (!/Anchor\s+Word\s+Challenge\s+#/i.test(title)) continue; // likely not a challenge post

          const solvedKey = `anchor:user:solved:${pid}:${username}`;
          const isSolved = await redis.get(solvedKey);
          if (isSolved === '1') continue; // skip solved

          const url = `https://www.reddit.com/r/${subredditName}/comments/${pid}/`;
          res.json({ type: 'find_another', navigateTo: url });
          return;
        }
      }
    } catch (e) {
      // ignore network issues
    }

    // No unsolved challenges found in any source
    res.json({ type: 'find_another', navigateTo: null });
  } catch (e) {
    console.error('Find another challenge error', e);
    res.status(500).json({ status: 'error', message: 'Failed to find another challenge' });
  }
});

// Anchor: Get challenge results (only for solved users)
router.get('/api/anchor/results', async (_req, res): Promise<void> => {
  try {
    console.log('Starting challenge results API call');
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    console.log('Username:', username);
    
    const postId = context.postId;
    console.log('Post ID:', postId);
    
    if (!postId) {
      console.log('No post ID found');
      res.status(400).json({ status: 'error', message: 'No post ID found' });
      return;
    }
    
    // Check if user has solved this challenge
    const solvedKey = `anchor:user:solved:${postId}:${username}`;
    console.log('Checking solved key:', solvedKey);
    const isSolved = await redis.get(solvedKey);
    console.log('Is solved:', isSolved);
    
    if (isSolved !== '1') {
      console.log('User has not solved challenge');
      res.status(403).json({ status: 'error', message: 'You must solve the challenge first to view results' });
      return;
    }
    
    // Get challenge data
    console.log('Getting post data...');
    const data = context.postData as AnchorPostData | undefined;
    console.log('Post data:', data);
    
    if (!data) {
      console.log('No challenge data found');
      res.status(404).json({ status: 'error', message: 'Challenge not found' });
      return;
    }
    
    // Get total attempts and solvers
    console.log('Getting total attempts...');
    const totalAttemptsKey = `anchor:total:attempts:${postId}`;
    const totalAttempts = await redis.get(totalAttemptsKey) || '0';
    console.log('Total attempts:', totalAttempts);
    
    console.log('Getting solvers data...');
    const solversKey = `anchor:solvers:${postId}`;
    const solversData = await redis.hGetAll(solversKey);
    console.log('Solvers data:', solversData);
    const totalSolvers = solversData ? Object.keys(solversData).length : 0;
    console.log('Total solvers:', totalSolvers);
    
    // Get all answers with attempt numbers
    console.log('Getting answers data...');
    const answersKey = `anchor:answers:${postId}`;
    console.log('Fetching answers from key:', answersKey);
    const answersData = await redis.hGetAll(answersKey);
    console.log('Answers data:', answersData);
    
    // Handle case where hGetAll returns undefined
    const answers = answersData ? Object.entries(answersData).map(([key, answer]) => {
      const [user, attemptNum] = key.split(':');
      return {
        user: user || '',
        attempt: parseInt(attemptNum || '0') || 0,
        answer,
        isCorrect: answer === data.anchor
      };
    }).sort((a, b) => a.attempt - b.attempt) : [];
    console.log('Processed answers:', answers);
    
    const response = {
      type: 'challenge_results',
      totalAttempts: parseInt(totalAttempts) || 0,
      totalSolvers: totalSolvers || 0,
      answers: answers || [],
      anchor: data.anchor
    };
    
    console.log('Sending response:', response);
    res.json(response);
  } catch (e) {
    console.error('Challenge results error:', e);
    console.error('Error details:', {
      message: e instanceof Error ? e.message : 'Unknown error',
      stack: e instanceof Error ? e.stack : undefined
    });
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to load challenge results',
      details: e instanceof Error ? e.message : 'Unknown error'
    });
  }
});

// Anchor Word: Init
router.get<
  { postId: string },
  AnchorInitResponse | { status: string; message: string }
>('/api/anchor/init', async (_req, res): Promise<void> => {
  const { postId, postData } = context;
  if (!postId) {
    res.status(400).json({ status: 'error', message: 'postId is required' });
    return;
  }
  // Note: Redis set operations are not available in current Devvit Redis client
  const data = (postData as unknown) as AnchorPostData | undefined;
  let clues: string[] | undefined = undefined;
  if (data?.anchor && Array.isArray(data.words)) {
    const a = data.anchor.toLowerCase();
    clues = data.words
      .map((w) => stripAnchorFromWord(a, w.toLowerCase()))
      .filter((c): c is string => c !== null);
  }
  // per-user state
  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const attemptsKey = `anchor:user:attempts:${postId}:${username}`;
  const solvedKey = `anchor:user:solved:${postId}:${username}`;
  const awardKey = `anchor:user:award:${postId}:${username}`; // last award for this post
  const [attemptsStr, hasSolvedStr, awardStr] = await Promise.all([
    redis.get(attemptsKey),
    redis.get(solvedKey),
    redis.get(awardKey),
  ]);
  const attempts = attemptsStr ? parseInt(attemptsStr) : 0;
  const hasSolved = hasSolvedStr === '1';
  const score = awardStr ? parseInt(awardStr) : undefined;
  const base: AnchorInitResponse = {
    type: 'anchor_init',
    postId,
    hasChallenge: !!data,
    clues: clues ?? [],
    attempts,
    hasSolved,
  } as AnchorInitResponse;
  if (typeof score === 'number') (base as any).score = score;
  // Expose the anchor and words so client can validate locally for faster UX
  if (data?.anchor) (base as any).anchor = data.anchor;
  if (data?.words) (base as any).words = data.words;
  // Mark if current user is the creator of this challenge
  try {
    const allChallengesKey = 'anchor:all:challenges';
    const infoStr = await redis.hGet(allChallengesKey, postId);
    if (infoStr) {
      const info = JSON.parse(infoStr) as { creator?: string };
      (base as any).isCreator = info?.creator && info.creator === username;
    }
  } catch {
    // ignore and omit isCreator
  }
  res.json(base);
});

// Anchor Word: Create challenge (sets post data)
router.post<
  { postId: string },
  AnchorCreateResponse | { status: string; message: string },
  { anchor: string; words: string[] }
>('/api/anchor/create', async (req, res): Promise<void> => {
  const { subredditName } = context;
  if (!subredditName) {
    res.status(400).json({ status: 'error', message: 'subredditName is required' });
    return;
  }

  const anchor = (req.body?.anchor ?? '').toString().trim().toLowerCase();
  const words = Array.isArray(req.body?.words) ? req.body.words.map((c: unknown) => String(c).trim().toLowerCase()) : [];
  if (!anchor || words.length < 4 || words.length > 6) {
    res.status(400).json({ status: 'error', message: 'Provide an anchor and 4–6 words' });
    return;
  }

  const dict = await getDict();
  if (!isAlpha(anchor) || !dict.has(anchor)) {
    res.status(400).json({ status: 'error', message: 'Anchor must be a real word (letters only)' });
    return;
  }
  for (const w of words) {
    if (!isAlpha(w) || !dict.has(w)) {
      res.status(400).json({ status: 'error', message: `Invalid word: ${w}. All words must be real.` });
      return;
    }
    const stripped = stripAnchorFromWord(anchor, w);
    if (!stripped || stripped.length === 0) {
      res.status(400).json({ status: 'error', message: `Each word must start or end with the anchor and be longer than it: ${w}` });
      return;
    }
    if (!dict.has(stripped)) {
      res.status(400).json({ status: 'error', message: `Each remainder must be a valid word too: ${w} → ${stripped}` });
      return;
    }
  }

  try {
    // Get the next challenge number per-subreddit
    const counterKey = `anchor:challengeCount:${subredditName}`;
    const nextNum = await redis.incrBy(counterKey, 1);

    // Create a new custom post as the user (requires devvit.json reddit.asUser.SUBMIT_POST)
    const created = await reddit.submitCustomPost({
      runAs: 'USER',
      subredditName,
      title: `Anchor Word Challenge #${nextNum}`,
      userGeneratedContent: {
        text: 'Anchor Word challenge – guess the shared anchor substring!'
      }
    });

    // Attach game data to the newly created post
    const newData: AnchorPostData = { anchor, words, attempts: 0 };
    await created.setPostData(newData);
    
    // Track this challenge for the user using Redis hash
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const userChallengesKey = `anchor:user:challenges:${username}`;
    const challengeInfo = {
      title: `Anchor Word Challenge #${nextNum}`,
      created: new Date().toISOString(),
      anchor,
      words,
      creator: username
    };
    
    await redis.hSet(userChallengesKey, {
      [created.id]: JSON.stringify(challengeInfo)
    });
    
    // Also store in global challenges store for "Find Another" functionality
    const allChallengesKey = 'anchor:all:challenges';
    await redis.hSet(allChallengesKey, {
      [created.id]: JSON.stringify(challengeInfo)
    });

    res.json({
      type: 'anchor_create',
      postId: created.id,
      navigateTo: `https://www.reddit.com/r/${subredditName}/comments/${created.id}/`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Failed to create user post', e);
    res.status(400).json({ status: 'error', message: `Failed to create post: ${msg}` });
  }
});

// Anchor Word: Submit guess
router.post<
  { postId: string },
  AnchorGuessResponse | { status: string; message: string },
  { guess: string }
>('/api/anchor/guess', async (req, res): Promise<void> => {
  const { postId, postData } = context;
  if (!postId) {
    res.status(400).json({ status: 'error', message: 'postId is required' });
    return;
  }
  const data = (postData as unknown) as AnchorPostData | undefined;
  if (!data) {
    res.status(400).json({ status: 'error', message: 'No challenge found for this post' });
    return;
  }
  const guess = (req.body?.guess ?? '').toString().trim().toLowerCase();
  if (!guess) {
    res.status(400).json({ status: 'error', message: 'guess is required' });
    return;
  }
  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';

  // Prevent users from guessing on their own challenge posts
  try {
    const allChallengesKey = 'anchor:all:challenges';
    const infoStr = await redis.hGet(allChallengesKey, postId);
    if (infoStr) {
      try {
        const info = JSON.parse(infoStr) as { creator?: string };
        if (info?.creator && info.creator === username) {
          res.status(403).json({ status: 'error', message: "You can't guess on your own challenge." });
          return;
        }
      } catch {
        // ignore parse errors
      }
    }
  } catch (e) {
    // Non-fatal; proceed if creator not found
  }
  const attemptsKey = `anchor:user:attempts:${postId}:${username}`;
  const solvedKey = `anchor:user:solved:${postId}:${username}`;
  const awardKey = `anchor:user:award:${postId}:${username}`;
  const scoreKey = `anchor:user:score:${username}`;
  const prevAttempts = parseInt((await redis.get(attemptsKey)) ?? '0');
  const wasSolved = (await redis.get(solvedKey)) === '1';
  if (wasSolved) {
    res.json({ type: 'anchor_guess', postId, result: 'correct', attempts: prevAttempts, hasSolved: true, anchor: data.anchor, words: data.words });
    return;
  }
  const attempts = prevAttempts + 1;
  await redis.set(attemptsKey, attempts.toString());
  
  // Track total attempts for this post
  const totalAttemptsKey = `anchor:total:attempts:${postId}`;
  await redis.incrBy(totalAttemptsKey, 1);
  
  const result = guess === data.anchor ? 'correct' : 'incorrect';
  
  // Track all answers (both correct and incorrect) with attempt numbers
  const answersKey = `anchor:answers:${postId}`;
  await redis.hSet(answersKey, {
    [`${username}:${attempts}`]: guess
  });
  
  if (result === 'correct') {
    // scoring rules: 1st=20, 2nd=15, 3rd=10, else=5
    const scoreAward = attempts === 1 ? 20 : attempts === 2 ? 15 : attempts === 3 ? 10 : 5;
    
    // Track this user as a solver using Redis hash
    const solversKey = `anchor:solvers:${postId}`;
    
    await Promise.all([
      redis.set(solvedKey, '1'),
      redis.set(awardKey, scoreAward.toString()),
      redis.incrBy(scoreKey, scoreAward),
      redis.hSet(solversKey, {
        [username]: '1' // Mark as solved
      })
    ]);
    // Update global leaderboard using Redis hash
    try {
      await redis.hSet('anchor:leaderboard:scores', {
        [username]: (parseInt(await redis.hGet('anchor:leaderboard:scores', username) || '0') + scoreAward).toString()
      });
    } catch (e) {
      console.error('Failed to update leaderboard', e);
    }
    res.json({ type: 'anchor_guess', postId, result, attempts, hasSolved: true, score: scoreAward, anchor: data.anchor, words: data.words });
    return;
  }
  res.json({ type: 'anchor_guess', postId, result, attempts });
});

router.post<{ postId: string }, IncrementResponse | { status: string; message: string }, unknown>(
  '/api/increment',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', 1),
      postId,
      type: 'increment',
    });
  }
);

router.post<{ postId: string }, DecrementResponse | { status: string; message: string }, unknown>(
  '/api/decrement',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', -1),
      postId,
      type: 'decrement',
    });
  }
);

router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      status: 'success',
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      navigateTo: `https://www.reddit.com/r/${context.subredditName}/comments/${post.id}/`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

// Anchor: Post a user comment about their earned points on this challenge
router.post('/api/anchor/comment', async (_req, res): Promise<void> => {
  try {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({ status: 'error', message: 'postId is required' });
      return;
    }
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';

    // Ensure this user solved the challenge before allowing comment
    const solvedKey = `anchor:user:solved:${postId}:${username}`;
    const isSolved = await redis.get(solvedKey);
    if (isSolved !== '1') {
      res.status(403).json({ status: 'error', message: 'You must solve the challenge before commenting.' });
      return;
    }

    // Determine points earned
    const awardKey = `anchor:user:award:${postId}:${username}`;
    let points = parseInt((await redis.get(awardKey)) ?? '0');
    if (!points || Number.isNaN(points)) {
      // Compute based on attempts as fallback
      const attemptsKey = `anchor:user:attempts:${postId}:${username}`;
      const attempts = parseInt((await redis.get(attemptsKey)) ?? '0');
      points = attempts === 1 ? 20 : attempts === 2 ? 15 : attempts === 3 ? 10 : 5;
    }

    const id = (`t3_${postId}`) as `t3_${string}`;
    const text = `I earned ${points} Anchor points from this challenge!`;
    // Post as USER (plaintext), mirroring submitCustomPost runAs: 'USER'
    await reddit.submitComment({ id, text, runAs: 'USER' });

    res.json({ status: 'ok' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('anchor comment error', e);
    if (msg.includes('403')) {
      res.status(403).json({ status: 'error', message: 'Reddit rejected the request (403). Ensure the playtest install has User Actions approved for SUBMIT_COMMENT and that the post allows comments (not locked/archived).' });
      return;
    }
    res.status(400).json({ status: 'error', message: msg });
  }
});

// Use router middleware
app.use(router);

// Get port from environment variable with fallback
const port = getServerPort();

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);

