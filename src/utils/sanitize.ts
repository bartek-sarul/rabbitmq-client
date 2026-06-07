/**
 * Sanitizes smart/curly quotes (commonly auto-corrected by macOS) and converts
 * them to standard ASCII straight double or single quotes.
 */
export function sanitizeQuotes(val: string): string {
  return val
    .replace(/[\u201C\u201D\u201F\u2033\u2036]/g, '"') // Double quotes
    .replace(/[\u2018\u2019\u201B\u2032\u2035]/g, "'"); // Single quotes
}
