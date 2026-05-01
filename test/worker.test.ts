import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const SITE_KEY = 'change-me';
const ADMIN_KEY = 'change-me-too';

function post(overrides: Record<string, unknown> = {}) {
  return SELF.fetch('https://test.local/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteKey: SITE_KEY,
      url: '/test',
      author: 'Alice',
      text: 'Hello world',
      ...overrides,
    }),
  });
}

function get(params: string) {
  return SELF.fetch(`https://test.local/comments?${params}`);
}

// --- POST /comment ---

describe('POST /comment', () => {
  it('creates a comment and returns its id', async () => {
    const res = await post({ url: '/post/create' });
    expect(res.status).toBe(201);

    const body = await res.json<{ success: boolean; id: string }>();
    expect(body.success).toBe(true);
    expect(body.id).toBeTruthy();

    const stored = await env.COMMENTS.get('comments/post/create.json');
    const comments = await stored!.json<{ id: string }[]>();
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(body.id);
  });

  it('appends to existing comments', async () => {
    await post({ url: '/post/append', author: 'Alice', text: 'First' });
    await post({ url: '/post/append', author: 'Bob', text: 'Second' });

    const stored = await env.COMMENTS.get('comments/post/append.json');
    const comments = await stored!.json<{ author: string }[]>();
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe('Alice');
    expect(comments[1].author).toBe('Bob');
  });

  it('rejects invalid site key', async () => {
    const res = await post({ siteKey: 'wrong', url: '/post/bad-key' });
    expect(res.status).toBe(403);

    const stored = await env.COMMENTS.get('comments/post/bad-key.json');
    expect(stored).toBeNull();
  });

  it('silently discards honeypot submissions', async () => {
    const res = await post({ url: '/post/honeypot', website2: 'http://spam.example' });
    expect(res.status).toBe(200);

    const body = await res.json<{ success: boolean; id?: string }>();
    expect(body.success).toBe(true);
    expect(body.id).toBeUndefined();

    const stored = await env.COMMENTS.get('comments/post/honeypot.json');
    expect(stored).toBeNull();
  });

  it('rejects empty author', async () => {
    const res = await post({ url: '/post/no-author', author: '' });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only text', async () => {
    const res = await post({ url: '/post/blank-text', text: '   ' });
    expect(res.status).toBe(400);
  });

  it('trims author and text', async () => {
    await post({ url: '/post/trim', author: '  Alice  ', text: '  Hello  ' });

    const stored = await env.COMMENTS.get('comments/post/trim.json');
    const comments = await stored!.json<{ author: string; text: string }[]>();
    expect(comments[0].author).toBe('Alice');
    expect(comments[0].text).toBe('Hello');
  });
});

// --- GET /comments ---

describe('GET /comments?url=', () => {
  it('returns empty array for page with no comments', async () => {
    const res = await get('url=/get/empty');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns stored comments', async () => {
    await env.COMMENTS.put(
      'comments/get/stored.json',
      JSON.stringify([
        { id: '1', author: 'Alice', text: 'First', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: '2', author: 'Bob', text: 'Second', createdAt: '2026-01-02T00:00:00.000Z' },
      ]),
    );

    const res = await get('url=/get/stored');
    const comments = await res.json<{ author: string }[]>();
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe('Alice');
    expect(comments[1].author).toBe('Bob');
  });

  it('filters by since parameter', async () => {
    await env.COMMENTS.put(
      'comments/get/since.json',
      JSON.stringify([
        { id: '1', author: 'Alice', text: 'Old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: '2', author: 'Bob', text: 'New', createdAt: '2026-06-01T00:00:00.000Z' },
      ]),
    );

    const res = await get('url=/get/since&since=2026-03-01T00:00:00.000Z');
    const comments = await res.json<{ author: string }[]>();
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe('Bob');
  });

  it('since excludes exact matches (strict greater-than)', async () => {
    await env.COMMENTS.put(
      'comments/get/since-exact.json',
      JSON.stringify([
        { id: '1', author: 'Alice', text: 'At boundary', createdAt: '2026-03-01T00:00:00.000Z' },
      ]),
    );

    const res = await get('url=/get/since-exact&since=2026-03-01T00:00:00.000Z');
    const comments = await res.json<unknown[]>();
    expect(comments).toHaveLength(0);
  });
});

describe('GET /comments (all)', () => {
  it('returns comments grouped by page path', async () => {
    await env.COMMENTS.put(
      'comments/get/all-a.json',
      JSON.stringify([{ id: '1', author: 'Alice', text: 'A', createdAt: '2026-01-01T00:00:00.000Z' }]),
    );
    await env.COMMENTS.put(
      'comments/get/all-b.json',
      JSON.stringify([{ id: '2', author: 'Bob', text: 'B', createdAt: '2026-01-01T00:00:00.000Z' }]),
    );

    const res = await SELF.fetch('https://test.local/comments');
    const data = await res.json<Record<string, { author: string }[]>>();

    expect(data['/get/all-a']).toBeDefined();
    expect(data['/get/all-a'][0].author).toBe('Alice');
    expect(data['/get/all-b']).toBeDefined();
    expect(data['/get/all-b'][0].author).toBe('Bob');
  });

  it('respects since filter on all-comments endpoint', async () => {
    await env.COMMENTS.put(
      'comments/get/all-since.json',
      JSON.stringify([
        { id: '1', author: 'Old', text: 'x', createdAt: '2025-01-01T00:00:00.000Z' },
        { id: '2', author: 'New', text: 'x', createdAt: '2026-06-01T00:00:00.000Z' },
      ]),
    );

    const res = await SELF.fetch('https://test.local/comments?since=2026-01-01T00:00:00.000Z');
    const data = await res.json<Record<string, { author: string }[]>>();

    expect(data['/get/all-since']).toHaveLength(1);
    expect(data['/get/all-since'][0].author).toBe('New');
  });
});

// --- DELETE /comment ---

describe('DELETE /comment', () => {
  function del(params: string, key?: string) {
    return SELF.fetch(`https://test.local/comment?${params}`, {
      method: 'DELETE',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
  }

  it('deletes a comment by id', async () => {
    await env.COMMENTS.put(
      'comments/del/target.json',
      JSON.stringify([
        { id: 'keep', author: 'Alice', text: 'Good', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'remove', author: 'Spammer', text: 'Buy stuff', createdAt: '2026-01-02T00:00:00.000Z' },
      ]),
    );

    const res = await del('url=/del/target&id=remove', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(await res.json<{ success: boolean }>()).toEqual({ success: true });

    const stored = await env.COMMENTS.get('comments/del/target.json');
    const comments = await stored!.json<{ id: string }[]>();
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe('keep');
  });

  it('returns 401 without admin key', async () => {
    const res = await del('url=/del/noauth&id=x');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong admin key', async () => {
    const res = await del('url=/del/wrongkey&id=x', 'wrong');
    expect(res.status).toBe(401);
  });

  it('returns 400 when url or id is missing', async () => {
    const res1 = await del('url=/del/missing-id', ADMIN_KEY);
    expect(res1.status).toBe(400);

    const res2 = await del('id=some-id', ADMIN_KEY);
    expect(res2.status).toBe(400);
  });

  it('returns 404 when comment does not exist', async () => {
    await env.COMMENTS.put(
      'comments/del/notfound.json',
      JSON.stringify([{ id: 'exists', author: 'A', text: 'x', createdAt: '2026-01-01T00:00:00.000Z' }]),
    );

    const res = await del('url=/del/notfound&id=nope', ADMIN_KEY);
    expect(res.status).toBe(404);
  });
});

// --- Storage key normalization ---

describe('URL normalization', () => {
  it('handles full URLs and bare paths the same', async () => {
    await post({ url: 'https://blog.example.com/posts/hello/' });

    const stored = await env.COMMENTS.get('comments/posts/hello.json');
    expect(stored).not.toBeNull();

    const res = await get('url=/posts/hello');
    const comments = await res.json<unknown[]>();
    expect(comments).toHaveLength(1);
  });

  it('maps root URL to index', async () => {
    await post({ url: 'https://blog.example.com/' });

    const stored = await env.COMMENTS.get('comments/index.json');
    expect(stored).not.toBeNull();
  });
});

// --- CORS ---

describe('CORS', () => {
  it('handles OPTIONS preflight', async () => {
    const res = await SELF.fetch('https://test.local/comments', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('includes CORS headers on all responses', async () => {
    const res = await get('url=/cors-test');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// --- Routing ---

describe('routing', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await SELF.fetch('https://test.local/unknown');
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET on /comment', async () => {
    const res = await SELF.fetch('https://test.local/comment');
    expect(res.status).toBe(404);
  });
});
