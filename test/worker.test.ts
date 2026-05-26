import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const SITE_KEY = 'test-site-key';
const ADMIN_KEY = 'test-admin-key';

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

// --- Markdown rendering ---

describe('markdown rendering', () => {
  it('renders bold and italic', async () => {
    const res = await post({ url: '/md/bold', text: '**bold** and *italic*' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/bold');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).toContain('<strong>bold</strong>');
    expect(comments[0].html).toContain('<em>italic</em>');
  });

  it('renders inline code', async () => {
    const res = await post({ url: '/md/code', text: 'Use `console.log()`' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/code');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).toContain('<code>console.log()</code>');
  });

  it('renders strikethrough', async () => {
    const res = await post({ url: '/md/strike', text: '~~deleted~~' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/strike');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).toContain('<del>deleted</del>');
  });

  it('renders blockquotes', async () => {
    const res = await post({ url: '/md/quote', text: '> quoted text' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/quote');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).toContain('<blockquote>');
  });

  it('renders lists', async () => {
    const res = await post({ url: '/md/list', text: '- item one\n- item two' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/list');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).toContain('<ul>');
    expect(comments[0].html).toContain('<li>item one</li>');
    expect(comments[0].html).toContain('<li>item two</li>');
  });

  it('strips links', async () => {
    const res = await post({ url: '/md/links', text: '[click here](https://evil.com)' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/links');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).not.toContain('<a');
    expect(comments[0].html).not.toContain('href');
    expect(comments[0].html).not.toContain('evil.com');
  });

  it('strips images', async () => {
    const res = await post({ url: '/md/img', text: '![alt](https://evil.com/image.png)' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/img');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).not.toContain('<img');
    expect(comments[0].html).not.toContain('src=');
  });

  it('strips inline script tags', async () => {
    const res = await post({ url: '/md/script', text: 'Hello <script>alert(1)</script> world' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/script');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).not.toContain('<script');
    expect(comments[0].html).not.toContain('alert');
  });

  it('strips inline HTML tags', async () => {
    const res = await post({ url: '/md/html', text: '<div class="evil">content</div>' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/html');
    const comments = await getRes.json<{ html?: string }[]>();
    expect(comments[0].html).not.toContain('<div');
    expect(comments[0].html).not.toContain('class=');
  });

  it('strips event handler attributes', async () => {
    const res = await post({ url: '/md/events', text: 'text' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/events');
    const comments = await getRes.json<{ html?: string }[]>();
    // No attributes should be present at all
    expect(comments[0].html).not.toMatch(/on\w+=/);
  });

  it('preserves raw text alongside html', async () => {
    const res = await post({ url: '/md/both', text: '**bold**' });
    expect(res.status).toBe(201);

    const getRes = await get('url=/md/both');
    const comments = await getRes.json<{ text: string; html?: string }[]>();
    expect(comments[0].text).toBe('**bold**');
    expect(comments[0].html).toContain('<strong>bold</strong>');
  });

  it('backward compat: comments without html field are returned as-is', async () => {
    await env.COMMENTS.put(
      'comments/compat/old.json',
      JSON.stringify([
        { id: '1', author: 'Legacy', text: 'plain text', createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );

    const res = await get('url=/compat/old');
    const comments = await res.json<{ html?: string; text: string }[]>();
    expect(comments[0].text).toBe('plain text');
    expect(comments[0].html).toBeUndefined();
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
