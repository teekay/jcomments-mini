// Import comments from a jcomments API JSON dump.
//
// Usage:
//   node scripts/import-jcomments.js <dump.json>
//
// Input format (array of objects):
//   { postUrl, postedAt, text (HTML), author: { name, email, website } }
//
// Output: one JSON file per page in out/comments/, ready for R2 upload:
//   for f in out/comments/*.json; do
//     key="${f#out/}"
//     npx wrangler r2 object put "jcomments-mini/$key" --file "$f"
//   done

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node scripts/import-jcomments.js <dump.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

function stripHtml(html) {
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  text = text.replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text;
}

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

const pages = {};

for (const row of raw) {
  const key = storageKey(row.postUrl);
  if (!pages[key]) pages[key] = [];
  pages[key].push({
    id: crypto.randomUUID(),
    author: (row.author && row.author.name) || 'Anonymous',
    text: stripHtml(row.text || ''),
    createdAt: row.postedAt || new Date().toISOString(),
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
