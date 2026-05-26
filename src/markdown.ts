// Markdown rendering with strict HTML sanitization.
// Allowed: bold, italic, strikethrough, code, pre, blockquote, lists, line breaks.
// Blocked: links, images, scripts, embeds, inline HTML, and any attributes.

import { marked } from 'marked';
import { transformSync, walkSync, ELEMENT_NODE, type Node } from 'ultrahtml';
import sanitize from 'ultrahtml/transformers/sanitize';

const ALLOWED_TAGS = [
  'b',
  'i',
  'strong',
  'em',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'blockquote',
  'br',
  'p',
  'ul',
  'ol',
  'li',
];

const DROP_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'img',
  'video',
  'audio',
  'source',
  'canvas',
  'svg',
  'math',
];

function stripAllAttributes(node: Node): Node {
  walkSync(node, (n) => {
    if (n.type === ELEMENT_NODE) {
      n.attributes = {};
    }
  });
  return node;
}

export function renderMarkdown(text: string): string {
  const rawHtml = marked.parse(text, { async: false }) as string;
  return transformSync(rawHtml, [
    sanitize({
      dropElements: DROP_TAGS,
      unblockElements: ALLOWED_TAGS,
    }),
    stripAllAttributes,
  ]);
}
