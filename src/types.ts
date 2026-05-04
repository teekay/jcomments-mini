// Shared type definitions for the worker and its bindings.

export interface Comment {
  id: string;
  author: string;
  email?: string;
  text: string;
  createdAt: string;
}

export interface SpamEntry {
  timestamp: string;
  reason: 'honeypot' | 'turnstile';
  ip: string;
  author?: string;
  url?: string;
}

export interface Env {
  COMMENTS: R2Bucket;
  SITE_KEY: string;
  TURNSTILE_SECRET?: string;
  ADMIN_KEY: string;
}
