/**
 * Characters that are structural in Lucene query syntax. This mirrors
 * Lucene's own QueryParserBase.escape(), which escapes '&' and '|'
 * individually rather than treating '&&' and '||' as units.
 */
export const RESERVED = new Set([
  '\\', '+', '-', '!', '(', ')', ':', '^', '[', ']', '"', '{', '}',
  '~', '*', '?', '|', '&', '/',
]);

// Control characters (U+0000–U+001F and U+007F). Built from an escaped string
// so no literal control bytes appear in the source.
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

function stripControl(s: string): string {
  return String(s).replace(CONTROL_RE, ' ');
}

/**
 * Escape a bare (unquoted) Lucene term.
 */
export function escapeTerm(input: string): string {
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
export function quotePhrase(input: string): string {
  const s = stripControl(input).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${s}"`;
}

/**
 * Canonical genre form used for querying and for cache keys.
 */
export function normalizeGenre(input: string): string {
  return stripControl(input).trim().replace(/\s+/g, ' ').toLowerCase();
}
