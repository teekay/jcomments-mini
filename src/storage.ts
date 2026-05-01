// R2 storage layer. One JSON file per page, keyed by URL path.

import { Comment, Env } from './types';

export function storageKey(pageUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    pathname = pageUrl;
  }
  const slug = pathname.replace(/^\/|\/$/g, '') || 'index';
  return `comments/${slug}.json`;
}

function pagePathFromKey(key: string): string {
  return '/' + key.replace(/^comments\//, '').replace(/\.json$/, '');
}

export async function getComments(env: Env, pageUrl: string): Promise<Comment[]> {
  const key = storageKey(pageUrl);
  const object = await env.COMMENTS.get(key);
  if (!object) return [];
  return object.json();
}

export async function getAllComments(env: Env): Promise<Record<string, Comment[]>> {
  const listed = await env.COMMENTS.list({ prefix: 'comments/' });
  const entries = await Promise.all(
    listed.objects.map(async (obj) => {
      const data = await env.COMMENTS.get(obj.key);
      if (!data) return null;
      const comments: Comment[] = await data.json();
      return [pagePathFromKey(obj.key), comments] as const;
    }),
  );

  const result: Record<string, Comment[]> = {};
  for (const entry of entries) {
    if (entry) result[entry[0]] = entry[1];
  }
  return result;
}

export async function deleteComment(env: Env, pageUrl: string, commentId: string): Promise<boolean> {
  const key = storageKey(pageUrl);
  const comments = await getComments(env, pageUrl);
  const filtered = comments.filter((c) => c.id !== commentId);
  if (filtered.length === comments.length) return false;
  await env.COMMENTS.put(key, JSON.stringify(filtered));
  return true;
}

export async function addComment(env: Env, pageUrl: string, comment: Comment): Promise<void> {
  const key = storageKey(pageUrl);
  const comments = await getComments(env, pageUrl);
  comments.push(comment);
  await env.COMMENTS.put(key, JSON.stringify(comments));
}
