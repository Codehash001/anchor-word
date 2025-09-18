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
  res.json({
    type: 'anchor_init',
    postId,
    hasChallenge: !!data,
    clues: data?.clues ?? [],
    attempts: data?.attempts ?? 0,
  });
});

// Anchor Word: Create challenge (sets post data)
router.post<
  { postId: string },
  AnchorCreateResponse | { status: string; message: string },
  { answer: string; clues: string[] }
>('/api/anchor/create', async (req, res): Promise<void> => {
  const { subredditName } = context;
  if (!subredditName) {
    res.status(400).json({ status: 'error', message: 'subredditName is required' });
    return;
  }

  const answer = (req.body?.answer ?? '').toString().trim();
  const clues = Array.isArray(req.body?.clues) ? req.body.clues.map((c: unknown) => String(c)) : [];
  if (!answer || clues.length === 0) {
    res.status(400).json({ status: 'error', message: 'answer and clues are required' });
    return;
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
    const newData: AnchorPostData = { answer: answer.toLowerCase(), clues, attempts: 0 };
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
  const attempts = (data.attempts ?? 0) + 1;
  const result = guess === data.answer ? 'correct' : 'incorrect';
  // persist attempts
  const post = await reddit.getPostById(postId);
  await post.setPostData({ ...data, attempts });
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
