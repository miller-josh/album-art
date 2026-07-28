'use strict';

/**
 * Characters that are structural in Lucene query syntax. This mirrors
 * Lucene's own QueryParserBase.escape(), which escapes '&' and '|'
 * individually rather than treating '&&' and '||' as units.
 */
const RESERVED = new Set([
  '\\', '+', '-', '!', '(', ')', ':', '^', '[', ']', '"', '{', '}',
  '~', '*', '?', '|', '&', '/',
]);

function stripControl(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ');
}

/**
 * Escape a bare (unquoted) Lucene term.
 */
function escapeTerm(input) {
  let out = '';
  for (const ch of stripControl(input)) {
    if (RESERVED.has(ch)) out += '\\';
    out += ch;
  }
  return out;
}

/**
 * Escape and wrap a value as a quoted Lucene phrase.
 *
 * Inside a phrase only the backslash and the double quote are structural, so
 * escaping just those keeps multiword and punctuated genres ("hip hop",
 * "r&b", "drum & bass") matchable while making it impossible for input to
 * break out of the quotes.
 */
function quotePhrase(input) {
  const s = stripControl(input).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${s}"`;
}

/**
 * Canonical genre form used for querying and for cache keys.
 */
function normalizeGenre(input) {
  return stripControl(input).trim().replace(/\s+/g, ' ').toLowerCase();
}

module.exports = { escapeTerm, quotePhrase, normalizeGenre, RESERVED };
