import { client } from '../db/index.js';
import { env } from '../env.js';
import { pollDueFeeds } from './poll.js';

/**
 * The feed poller runs as its own process (`start:worker`) so feed refresh is
 * independent of any browser being open. It ticks on a fixed interval and, on
 * each tick, fetches every feed whose refresh window has elapsed.
 */
let running = true;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  const startedAt = Date.now();
  try {
    const count = await pollDueFeeds();
    if (count > 0) {
      console.log(`[worker] polled ${count} feed(s) in ${Date.now() - startedAt}ms`);
    }
  } catch (err) {
    console.error('[worker] tick failed', err);
  } finally {
    ticking = false;
  }
}

async function main(): Promise<void> {
  console.log(`[worker] started, tick interval ${env.FEED_POLL_INTERVAL_SEC}s`);
  await tick();
  const timer = setInterval(() => void tick(), env.FEED_POLL_INTERVAL_SEC * 1000);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, stopping`);
    running = false;
    clearInterval(timer);
    await client.end({ timeout: 5 });
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  // Keep the event loop alive until a signal arrives.
  while (running) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

void main();
