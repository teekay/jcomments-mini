// Build-time helper to fetch comments from jcomments-mini.
//
// As a module (e.g. Eleventy _data/comments.js):
//   const { fetchAllComments, fetchCommentsForPage } = require('../scripts/fetch-comments');
//   module.exports = () => fetchAllComments('https://jcomments-mini.<you>.workers.dev');
//
// As CLI:
//   node scripts/fetch-comments.js https://jcomments-mini.<you>.workers.dev

const ENDPOINT = process.env.JCOMMENTS_ENDPOINT || process.argv[2];

async function fetchAllComments(endpoint) {
  const res = await fetch(`${endpoint}/comments`);
  if (!res.ok) throw new Error(`Failed to fetch comments: ${res.status}`);
  return res.json();
}

async function fetchCommentsForPage(endpoint, pageUrl) {
  const params = new URLSearchParams({ url: pageUrl });
  const res = await fetch(`${endpoint}/comments?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch comments: ${res.status}`);
  return res.json();
}

module.exports = { fetchAllComments, fetchCommentsForPage };

if (require.main === module && ENDPOINT) {
  fetchAllComments(ENDPOINT)
    .then((data) => console.log(JSON.stringify(data, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
