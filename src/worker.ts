// Cloudflare Worker entry point. Three routes:
//   GET    /comments  — fetch comments (one page or all, with optional ?since= filter)
//   POST   /comment   — submit a new comment (validated, spam-checked, stored in R2)
//   DELETE /comment   — remove a comment by id (requires ADMIN_KEY via Bearer token)

import { Env, Comment } from './types';
import { getComments, getAllComments, addComment, deleteComment } from './storage';
import { isHoneypotFilled, verifyTurnstile } from './spam';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: CORS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/comments') {
        return handleGet(url, env);
      }
      if (request.method === 'POST' && url.pathname === '/comment') {
        return handlePost(request, env);
      }
      if (request.method === 'DELETE' && url.pathname === '/comment') {
        return handleDelete(request, url, env);
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal error';
      return json({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleGet(url: URL, env: Env): Promise<Response> {
  const pageUrl = url.searchParams.get('url');
  const since = url.searchParams.get('since');

  if (!pageUrl) {
    const all = await getAllComments(env);
    if (!since) return json(all);

    const filtered: Record<string, Comment[]> = {};
    for (const [page, comments] of Object.entries(all)) {
      const newer = comments.filter((c) => c.createdAt > since);
      if (newer.length) filtered[page] = newer;
    }
    return json(filtered);
  }

  let comments = await getComments(env, pageUrl);
  if (since) {
    comments = comments.filter((c) => c.createdAt > since);
  }
  return json(comments);
}

async function handleDelete(request: Request, url: URL, env: Env): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token || token !== env.ADMIN_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const pageUrl = url.searchParams.get('url');
  const commentId = url.searchParams.get('id');
  if (!pageUrl || !commentId) {
    return json({ error: 'Missing url or id parameter' }, 400);
  }

  const deleted = await deleteComment(env, pageUrl, commentId);
  if (!deleted) {
    return json({ error: 'Comment not found' }, 404);
  }

  return json({ success: true });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    return request.json();
  }
  const formData = await request.formData();
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    obj[key] = value;
  }
  return obj;
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);

  if (body.siteKey !== env.SITE_KEY) {
    return json({ error: 'Invalid site key' }, 403);
  }

  if (isHoneypotFilled(body)) {
    return json({ success: true });
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const turnstileOk = await verifyTurnstile(
    (body['cf-turnstile-response'] as string) || '',
    env.TURNSTILE_SECRET || '',
    ip,
  );
  if (!turnstileOk) {
    return json({ success: true });
  }

  const author = (body.author as string)?.trim();
  const email = (body.email as string)?.trim() || undefined;
  const text = (body.text as string)?.trim();
  const pageUrl = body.url as string;

  if (!author || !text || !pageUrl) {
    return json({ error: 'Missing required fields: author, text, url' }, 400);
  }

  const comment: Comment = {
    id: crypto.randomUUID(),
    author,
    ...(email && { email }),
    text,
    createdAt: new Date().toISOString(),
  };

  await addComment(env, pageUrl, comment);
  return json({ success: true, id: comment.id }, 201);
}
