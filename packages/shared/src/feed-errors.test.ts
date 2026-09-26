import { describe, expect, test } from 'vitest';
import { describeFeedError, transientRetryDelaySec } from './feed-errors.js';

describe('describeFeedError', () => {
  test.each([
    ['getaddrinfo EAI_AGAIN daverupert.com', 'Could not look up the site. This is often a short network problem.', true],
    ['getaddrinfo ENOTFOUND nowhere.invalid', 'The site address does not exist.', false],
    ['connect ECONNREFUSED 10.0.0.1:443', 'The site refused the connection.', true],
    ['read ECONNRESET', 'The connection dropped.', true],
    ['other side closed', 'The connection dropped.', true],
    ['Connect Timeout Error (attempted address: x:443, timeout: 10000ms)', 'The site took too long to answer.', true],
    ['Headers Timeout Error', 'The site took too long to answer.', true],
    ['unable to verify the first certificate', 'The site has a security certificate problem.', false],
    ['HTTP 404', 'The feed is not at this address any more.', false],
    ['HTTP 410', 'The feed is not at this address any more.', false],
    ['HTTP 403', 'The site does not allow access to the feed.', false],
    ['HTTP 429', 'The site asks for fewer requests.', false],
    ['HTTP 503', 'The site is down or busy.', true],
    ['HTTP 500', 'The site had a server error.', false],
    ['Feed not recognized as RSS 1 or 2.', 'The address does not give a valid feed.', false],
    ['Non-whitespace before first tag.\nLine: 0', 'The address does not give a valid feed.', false],
    ['something odd', 'The feed could not be updated.', false],
  ])('%s', (message, summary, transient) => {
    expect(describeFeedError(message)).toEqual({ summary, transient });
  });
});

describe('transientRetryDelaySec', () => {
  test('a transient error retries after 2 minutes, then 10, then waits the normal interval', () => {
    const dns = 'getaddrinfo EAI_AGAIN example.com';
    expect(transientRetryDelaySec(dns, 1)).toBe(120);
    expect(transientRetryDelaySec(dns, 2)).toBe(600);
    expect(transientRetryDelaySec(dns, 3)).toBeNull();
  });

  test('a lasting error never retries early', () => {
    expect(transientRetryDelaySec('HTTP 404', 1)).toBeNull();
  });
});
