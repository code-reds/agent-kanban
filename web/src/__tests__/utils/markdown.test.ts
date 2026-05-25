import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderMarkdown } from '@/utils/markdown';
import * as marked from 'marked';
import DOMPurify from 'dompurify';

vi.mock('marked');
vi.mock('dompurify');

describe('renderMarkdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string for empty input', () => {
    const result = renderMarkdown('');
    expect(result).toBe('');
    expect(marked.parse).not.toHaveBeenCalled();
  });

  it('returns empty string for null input', () => {
    const result = renderMarkdown(null as unknown as string);
    expect(result).toBe('');
    expect(marked.parse).not.toHaveBeenCalled();
  });

  it('returns empty string for undefined input', () => {
    const result = renderMarkdown(undefined as unknown as string);
    expect(result).toBe('');
    expect(marked.parse).not.toHaveBeenCalled();
  });

  it('passes markdown through marked.parse', () => {
    (marked.parse as any).mockReturnValue('<p>Hello world</p>');
    (DOMPurify.sanitize as any).mockReturnValue('<p>Hello world</p>');

    renderMarkdown('# Hello');

    expect(marked.parse).toHaveBeenCalledWith('# Hello', { async: false });
  });

  it('sanitizes the rendered HTML via DOMPurify', () => {
    (marked.parse as any).mockReturnValue('<p>Hello world</p><script>alert(1)</script>');
    (DOMPurify.sanitize as any).mockReturnValue('<p>Hello world</p>');

    renderMarkdown('# Hello');

    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<p>Hello world</p><script>alert(1)</script>');
  });

  it('returns the sanitized HTML for plain text', () => {
    (DOMPurify.sanitize as any).mockReturnValue('<p>Hello world</p>');

    const result = renderMarkdown('Hello world');

    expect(result).toBe('<p>Hello world</p>');
  });

  it('renders bold text correctly', () => {
    (marked.parse as any).mockReturnValue('<p><strong>bold</strong></p>');
    (DOMPurify.sanitize as any).mockReturnValue('<p><strong>bold</strong></p>');

    const result = renderMarkdown('**bold**');

    expect(result).toBe('<p><strong>bold</strong></p>');
  });

  it('renders italic text correctly', () => {
    (marked.parse as any).mockReturnValue('<p><em>italic</em></p>');
    (DOMPurify.sanitize as any).mockReturnValue('<p><em>italic</em></p>');

    const result = renderMarkdown('*italic*');

    expect(result).toBe('<p><em>italic</em></p>');
  });

  it('renders headings correctly', () => {
    (marked.parse as any).mockReturnValue('<h1>Title</h1>');
    (DOMPurify.sanitize as any).mockReturnValue('<h1>Title</h1>');

    const result = renderMarkdown('# Title');

    expect(result).toBe('<h1>Title</h1>');
  });

  it('renders lists correctly', () => {
    (marked.parse as any).mockReturnValue('<ul><li>Item 1</li><li>Item 2</li></ul>');
    (DOMPurify.sanitize as any).mockReturnValue('<ul><li>Item 1</li><li>Item 2</li></ul>');

    const result = renderMarkdown('- Item 1\n- Item 2');

    expect(result).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>');
  });

  it('renders code blocks correctly', () => {
    (marked.parse as any).mockReturnValue('<pre><code>const x = 1;</code></pre>');
    (DOMPurify.sanitize as any).mockReturnValue('<pre><code>const x = 1;</code></pre>');

    const result = renderMarkdown('`const x = 1;`');

    expect(result).toBe('<pre><code>const x = 1;</code></pre>');
  });

  it('sanitizes dangerous scripts from markdown', () => {
    (marked.parse as any).mockReturnValue('<p>Safe text</p><script>document.cookie="hacked"</script>');
    (DOMPurify.sanitize as any).mockReturnValue('<p>Safe text</p>');

    const result = renderMarkdown('<script>alert(1)</script>');

    expect(result).toBe('<p>Safe text</p>');
  });

  it('sanitizes javascript: URLs in links', () => {
    (marked.parse as any).mockReturnValue('<a href="javascript:alert(1)">click</a>');
    (DOMPurify.sanitize as any).mockReturnValue('<a>click</a>');

    const result = renderMarkdown('[click](javascript:alert(1))');

    expect(result).toBe('<a>click</a>');
  });
});
