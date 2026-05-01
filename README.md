# jcomments-mini

A minimal, self-hosted commenting system for static websites. One cloud function, one JSON store, zero infrastructure to manage.

## Why use it

Most commenting platforms load comments dynamically in the browser. This one takes a different approach: your static site generator fetches comments at build time and bakes them into the HTML. The browser only requests comments added *after* the last build.

This means your comments survive outages, load instantly, and you own every byte of the data.

## When to use it

This is for publishers of personal or small-audience websites with a modest volume of comments. The feature set is deliberately minimal: plain text comments, spam filtering, and nothing else. No threads, no voting, no replies, no accounts, no dashboard.

If a spam comment slips through, you delete it with a single `curl` call.

## How it works

**Three HTTP routes** served by a single cloud function:

| Route | Purpose |
|---|---|
| `GET /comments?url=/some/page&since=<ISO timestamp>` | Fetch comments for a page. Omit `url` to get all comments grouped by page (for build-time). `since` is optional. |
| `POST /comment` | Submit a new comment. Requires `siteKey`, `url`, `author`, `text` in the JSON body. |
| `DELETE /comment?url=/some/page&id=<comment-id>` | Remove a comment. Requires `Authorization: Bearer <ADMIN_KEY>` header. |

**Storage**: one JSON file per page in object storage (Cloudflare R2 by default). No database.

**Spam prevention**: a hidden honeypot form field catches most bots. Optionally, add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) (free) for stronger protection. Spam is silently discarded.

**Client-side script** (`client/jcomments.js`): a zero-dependency browser script (~100 lines) that fetches comments newer than the build timestamp, renders them into the page, and handles form submission. Uses `textContent` exclusively to prevent XSS.

## Project structure

```
src/
  worker.ts       Cloudflare Worker entry point (request routing)
  storage.ts      R2 read/write operations
  spam.ts         Honeypot + Turnstile verification
  types.ts        Shared type definitions
client/
  jcomments.js    Browser script
scripts/
  fetch-comments.js   Build-time helper (Node.js module + CLI)
test/
  worker.test.ts  Integration tests (run against real Workers runtime)
```

## Prerequisites

- Node.js >= 18
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is sufficient)

## Setup and deployment

Install dependencies:

```sh
npm install
```

Install the Wrangler CLI (Cloudflare's deployment tool) if you don't have it globally:

```sh
npx wrangler login
```

Create the R2 bucket:

```sh
npx wrangler r2 bucket create jcomments-mini
```

Set your secrets:

```sh
npx wrangler secret put SITE_KEY       # arbitrary string, sent by the comment form
npx wrangler secret put ADMIN_KEY      # secret for deleting comments (keep this private)
```

Optionally, enable Turnstile. Create a widget at [Cloudflare Dashboard > Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile), then:

```sh
npx wrangler secret put TURNSTILE_SECRET
```

For local development, put these in a `.dev.vars` file (already gitignored):

```
SITE_KEY=my-local-key
ADMIN_KEY=my-local-admin-key
```

Deploy:

```sh
npm run deploy
```

This prints a URL like `https://jcomments-mini.<you>.workers.dev`. That's your endpoint.

## Local development

```sh
npm run dev
```

This starts a local Workers runtime with an in-memory R2 bucket. Changes hot-reload.

## Running tests

```sh
npm test
```

Tests run inside a real Workers runtime (via Miniflare) with in-memory R2 bindings. No mocks.

## Integration with your website

### Comment form HTML

Add this to your page template:

```html
<div id="jcomments">
  <!-- Comments baked in by your static site generator go here -->
</div>

<form id="jcomments-form">
  <input name="author" placeholder="Name" required>
  <textarea name="text" placeholder="Comment" required></textarea>
  <!-- Honeypot field, hidden from humans -->
  <div style="display:none">
    <input name="website2" tabindex="-1" autocomplete="off">
  </div>
  <!-- Optional: Turnstile widget -->
  <!-- <div class="cf-turnstile" data-sitekey="your-turnstile-site-key"></div> -->
  <button type="submit">Post comment</button>
</form>

<script src="/jcomments.js"></script>
<script>
new JComments({
  endpoint: 'https://jcomments-mini.<you>.workers.dev',
  siteKey: 'your-site-key',
  buildTimestamp: '{{ build.timestamp }}' // your SSG fills this at build time
});
</script>
```

If using Turnstile, also include the Turnstile script in your `<head>`:

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

### JComments options

| Option | Default | Description |
|---|---|---|
| `endpoint` | *(required)* | URL of your deployed worker |
| `siteKey` | *(required)* | Must match the `SITE_KEY` secret |
| `buildTimestamp` | `null` | ISO 8601 timestamp of the last build. When set, only comments newer than this are fetched. |
| `pageUrl` | `window.location.pathname` | Page identifier sent to the API |
| `containerId` | `'jcomments'` | ID of the element where comments are rendered |
| `formId` | `'jcomments-form'` | ID of the comment submission form |

### Deleting a comment

If spam gets through, find the comment's `id` (visible in the page source as `data-id` on each `.jcomment` element, or via the `GET /comments` API) and delete it:

```sh
curl -X DELETE \
  "https://jcomments-mini.<you>.workers.dev/comment?url=/blog/my-post&id=<comment-id>" \
  -H "Authorization: Bearer <your-admin-key>"
```

### Fetching comments at build time

The `scripts/fetch-comments.js` file exports two functions for use in your static site generator:

```js
const { fetchAllComments, fetchCommentsForPage } = require('./scripts/fetch-comments');

// All comments, grouped by page path: { "/blog/post": [{ id, author, text, createdAt }] }
const all = await fetchAllComments('https://jcomments-mini.<you>.workers.dev');

// Comments for a single page: [{ id, author, text, createdAt }]
const comments = await fetchCommentsForPage(
  'https://jcomments-mini.<you>.workers.dev',
  '/blog/my-post'
);
```

Or run it as a CLI:

```sh
JCOMMENTS_ENDPOINT=https://jcomments-mini.<you>.workers.dev node scripts/fetch-comments.js
```

## Adapting to other runtimes

The default implementation uses Cloudflare Workers, but the core logic has no Cloudflare-specific dependencies beyond the thin storage layer. To port to another runtime:

### AWS Lambda

1. Replace `src/worker.ts` with a Lambda handler. The routing logic (`handleGet`, `handlePost`, `handleDelete`) and the spam module (`src/spam.ts`) can be reused as-is.
2. Replace `src/storage.ts` with S3 calls. The interface is the same: `getComments`, `getAllComments`, `addComment`, `deleteComment`. Use the AWS SDK's `GetObjectCommand` / `PutObjectCommand` with the same JSON-file-per-page layout.
3. Set `SITE_KEY`, `ADMIN_KEY`, and `TURNSTILE_SECRET` as Lambda environment variables.
4. Put an API Gateway or Function URL in front of the Lambda.

### Google Cloud Functions

Same approach as Lambda. Replace storage calls with Google Cloud Storage (`@google-cloud/storage`). The HTTP function signature is slightly different but the logic is identical.

### Any Node.js server (Express, Fastify, etc.)

If you prefer a long-running process over serverless:

1. Create three route handlers mapping to `handleGet`, `handlePost`, and `handleDelete`.
2. For storage, you can use the filesystem (`fs.readFileSync` / `fs.writeFileSync` on JSON files), S3, GCS, or any key-value store.
3. The spam module works anywhere (it only uses `fetch`).

### What to change, what to keep

| Layer | File | Cloudflare-specific? | What to swap |
|---|---|---|---|
| Routing | `src/worker.ts` | Yes (Worker fetch handler) | Replace with your runtime's HTTP handler |
| Storage | `src/storage.ts` | Yes (R2 API) | Replace with your object store's SDK |
| Spam | `src/spam.ts` | No | Keep as-is (Turnstile works from any backend) |
| Types | `src/types.ts` | Partially (`R2Bucket` type) | Remove the `Env` interface or adapt it |
| Client | `client/jcomments.js` | No | Keep as-is |
| Build helper | `scripts/fetch-comments.js` | No | Keep as-is |

## Adapting to other data stores

The storage layer (`src/storage.ts`) is four functions:

```typescript
getComments(env, pageUrl)             // read one page's comments
getAllComments(env)                    // read all pages' comments
addComment(env, pageUrl, comment)     // append a comment
deleteComment(env, pageUrl, commentId) // remove a comment by id
```

The default implementation stores one JSON file per page in R2 under the key `comments/{page-slug}.json`. To use a different store, reimplement these three functions. Some options:

**AWS S3 / Google Cloud Storage / Azure Blob Storage**: Drop-in replacement. Same JSON-file-per-page layout; just swap the SDK calls. S3 is even API-compatible with R2.

**SQLite (local or Turso)**: Create a `comments` table with `page_url`, `id`, `author`, `text`, `created_at` columns. `getComments` becomes a `SELECT WHERE page_url = ?`. `getAllComments` becomes a `SELECT` grouped by `page_url`. Good choice if you're running a long-lived server instead of serverless.

**Redis / KV stores**: Store a JSON array per page key. Reads and writes are single-key operations, which maps naturally.

**Flat files on disk**: `fs.readFileSync('data/comments/page-slug.json')`. Works fine for a personal blog on a VPS. No SDK needed.

The choice doesn't affect the client script or the build-time fetcher — they talk to the HTTP API, not to the store directly.

## License

MIT
