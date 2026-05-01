// Import comments from a JSON export of the old jcomments SQLite database.
//
// 1. Export from SQLite:
//      sqlite3 jcomments.db "SELECT id, page_url, comment, reader_name, created_at FROM comments ORDER BY created_at" -json > export.json
//
// 2. Run this script (writes one JSON file per page into out/):
//      node scripts/import.js export.json
//
// 3. Upload to R2:
//      for f in out/comments/*.json; do
//        npx wrangler r2 object put "jcomments-mini/$f" --file "$f"
//      done

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node scripts/import.js <export.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

function storageKey(pageUrl) {
  let pathname;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    pathname = pageUrl;
  }
  const slug = pathname.replace(/^\/|\/$/g, '') || 'index';
  return `comments/${slug}.json`;
}

function normalizeTimestamp(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toISOString();
}

const pages = {};

for (const row of raw) {
  const key = storageKey(row.page_url);
  if (!pages[key]) pages[key] = [];
  pages[key].push({
    id: row.id,
    author: row.reader_name,
    text: row.comment,
    createdAt: normalizeTimestamp(row.created_at),
  });
}

const outDir = path.resolve('out');
for (const [key, comments] of Object.entries(pages)) {
  const filePath = path.join(outDir, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(comments));
}

const pageCount = Object.keys(pages).length;
const commentCount = raw.length;
console.log(`Wrote ${commentCount} comments across ${pageCount} pages to out/`);
console.log('');
console.log('Upload to R2:');
console.log('  for f in out/comments/*.json; do');
console.log('    key="${f#out/}"');
console.log('    npx wrangler r2 object put "jcomments-mini/$key" --file "$f"');
console.log('  done');
