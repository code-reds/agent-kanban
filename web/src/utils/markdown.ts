import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Parse markdown content to safe HTML.
 * Uses `marked` for markdown-to-HTML conversion and `dompurify` for sanitization
 * to prevent XSS attacks.
 *
 * @param markdown - The markdown string to render
 * @returns Sanitized HTML string
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) {
    return '';
  }

  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
