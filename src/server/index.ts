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
  const scoreKey = `anchor:user:score:${username}`; // cumulative (optional)
  const [attemptsStr, hasSolvedStr, scoreStr] = await Promise.all([
    redis.get(attemptsKey),
    redis.get(solvedKey),
    redis.get(scoreKey),
  ]);
  const attempts = attemptsStr ? parseInt(attemptsStr) : 0;
  const hasSolved = hasSolvedStr === '1';
  const score = scoreStr ? parseInt(scoreStr) : undefined;
  const base: AnchorInitResponse = {
    type: 'anchor_init',
    postId,
    hasChallenge: !!data,
    clues: clues ?? [],
    attempts,
    hasSolved,
  } as AnchorInitResponse;
  if (typeof score === 'number') (base as any).score = score;
  if (hasSolved && data?.anchor) (base as any).anchor = data.anchor;
  if (hasSolved && data?.words) (base as any).words = data.words;
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

    res.json({
      type: 'anchor_create',
      postId: created.id,
      navigateTo: `https://reddit.com/r/${subredditName}/comments/${created.id}`,
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
  const attemptsKey = `anchor:user:attempts:${postId}:${username}`;
  const solvedKey = `anchor:user:solved:${postId}:${username}`;
  const scoreKey = `anchor:user:score:${username}`;
  const prevAttempts = parseInt((await redis.get(attemptsKey)) ?? '0');
  const wasSolved = (await redis.get(solvedKey)) === '1';
  if (wasSolved) {
    res.json({ type: 'anchor_guess', postId, result: 'correct', attempts: prevAttempts, hasSolved: true, anchor: data.anchor, words: data.words });
    return;
  }
  const attempts = prevAttempts + 1;
  await redis.set(attemptsKey, attempts.toString());
  const result = guess === data.anchor ? 'correct' : 'incorrect';
  if (result === 'correct') {
    // scoring rules: 1st=20, 2nd=15, 3rd=10, else=5
    const scoreAward = attempts === 1 ? 20 : attempts === 2 ? 15 : attempts === 3 ? 10 : 5;
    await Promise.all([
      redis.set(solvedKey, '1'),
      redis.incrBy(scoreKey, scoreAward),
    ]);
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
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

// Use router middleware
app.use(router);

// Get port from environment variable with fallback
const port = getServerPort();

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);
