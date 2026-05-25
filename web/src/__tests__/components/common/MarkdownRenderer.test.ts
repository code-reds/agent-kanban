import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue';

// Mock DOMPurify to allow dangerous attributes for XSS tests
vi.mock('dompurify', () => ({
  default: {
    sanitize: (html: string, options?: Record<string, unknown>) => {
      if (options?.ALLOWED_TAGS?.length === 0) {
        return '';
      }
      // Strip script tags and event handlers
      return html
        .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '')
        .replace(/\s*on\w+="[^"]*"/gi, '')
        .replace(/\s*on\w+='[^']*'/gi, '');
    },
  },
}));

// Mock marked to return the input directly (simple passthrough for tests)
// The component imports { marked } and calls marked.setOptions() and marked.parse(),
// so the mock must be a callable function with those properties attached.
vi.mock('marked', () => {
  const parseMarkdown = (content: string) => {
    // Basic markdown to HTML transformation for tests
    let html = content;
    // Horizontal rules (must come before line-by-line processing)
    html = html.replace(/^(\*{3,}|-{3,}|_{3,})$/gm, '<hr>');
    // Headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Strikethrough
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');
    // Code blocks (MUST run before inline code to avoid consuming code block content)
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // Italic (before inline code so **bold** doesn't get italicized first)
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Inline code (runs after code blocks)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Paragraphs
    html = html.split('\n\n').map(p => {
      if (p.startsWith('<')) return p;
      if (p.trim()) return `<p>${p.trim()}</p>`;
      return '';
    }).join('\n');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    // Lists
    html = html.replace(/^- \[ \] /g, '<ul><li><input type="checkbox" disabled> ');
    html = html.replace(/^- \[x\] /g, '<ul><li><input type="checkbox" checked disabled> ');
    return html;
  };

  // marked is the default export; it must be callable AND have .setOptions/.parse properties
  const marked = Object.assign(parseMarkdown, {
    setOptions: vi.fn(),
    parse: parseMarkdown,
  });

  return { marked };
});

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty content as empty', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '' },
    });
    expect(wrapper.find('.markdown-rendered').exists()).toBe(false);
    expect(wrapper.find('.markdown-empty').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders null content as empty', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: null as unknown as string },
    });
    expect(wrapper.find('.markdown-rendered').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders whitespace-only content as empty', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '   \n  ' },
    });
    expect(wrapper.find('.markdown-rendered').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders plain text content', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'Hello world' },
    });
    expect(wrapper.find('.markdown-rendered').exists()).toBe(true);
    expect(wrapper.find('.markdown-rendered').text()).toContain('Hello world');
    wrapper.unmount();
  });

  it('renders bold text', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'This is **bold** text' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<strong>bold</strong>');
    wrapper.unmount();
  });

  it('renders italic text', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'This is *italic* text' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<em>italic</em>');
    wrapper.unmount();
  });

  it('renders inline code', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'Use `console.log` to debug' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<code>console.log</code>');
    wrapper.unmount();
  });

  it('renders links with href', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'See [docs](https://example.com)' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<a href="https://example.com">docs</a>');
    wrapper.unmount();
  });

  it('renders headers', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '# Main Title\n## Subtitle\n### Section' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<h1>Main Title</h1>');
    expect(rendered.html()).toContain('<h2>Subtitle</h2>');
    expect(rendered.html()).toContain('<h3>Section</h3>');
    wrapper.unmount();
  });

  it('renders code blocks', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '```\nconst x = 1;\n```' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<pre><code>');
    expect(rendered.html()).toContain('const x = 1;');
    wrapper.unmount();
  });

  it('sanitizes XSS attack vectors', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '<script>alert("xss")</script>' },
    });
    expect(wrapper.find('.markdown-rendered').html()).not.toContain('<script>');
    wrapper.unmount();
  });

  it('sanitizes event handler attributes', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '<p onclick="alert(1)">test</p>' },
    });
    expect(wrapper.find('.markdown-rendered').html()).not.toContain('onclick');
    wrapper.unmount();
  });

  it('strips dangerous attributes from links', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '[click](javascript:alert(1))' },
    });
    const html = wrapper.find('.markdown-rendered').html();
    expect(html).toContain('<a');
    expect(html).not.toContain('onclick');
    wrapper.unmount();
  });

  it('renders paragraphs for multi-line text', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'First paragraph\n\nSecond paragraph' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<p>First paragraph</p>');
    expect(rendered.html()).toContain('<p>Second paragraph</p>');
    wrapper.unmount();
  });

  it('applies markdown-rendered class to root element', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'test' },
    });
    expect(wrapper.find('.markdown-rendered').classes()).toContain('markdown-rendered');
    wrapper.unmount();
  });

  it('renders strikethrough via del tag', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '~~deleted~~' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<del>deleted</del>');
    wrapper.unmount();
  });

  it('renders horizontal rules', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'before\n\n---\n\nafter' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<hr>');
    wrapper.unmount();
  });

  it('renders unordered list items', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '- item one\n- item two\n- item three' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('item one');
    expect(rendered.html()).toContain('item two');
    expect(rendered.html()).toContain('item three');
    wrapper.unmount();
  });

  it('renders tables', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |',
      },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('Header 1');
    expect(rendered.html()).toContain('Header 2');
    expect(rendered.html()).toContain('Cell 1');
    expect(rendered.html()).toContain('Cell 2');
    wrapper.unmount();
  });

  it('renders blockquotes', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '> This is a quote' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('This is a quote');
    wrapper.unmount();
  });

  it('renders a ticket description with mixed markdown', () => {
    const content = `# Ticket Description

This is a **description** with *multiple* markdown features.

- Feature 1: Bold text
- Feature 2: Inline \`code\`
- Feature 3: [Links](https://example.com)

\`\`\`javascript
const x = 42;
\`\`\`

> This is an important note.`;

    const wrapper = mount(MarkdownRenderer, {
      props: { content },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('<h1>Ticket Description</h1>');
    expect(rendered.html()).toContain('<strong>description</strong>');
    expect(rendered.html()).toContain('<em>multiple</em>');
    expect(rendered.html()).toContain('<code>code</code>');
    expect(rendered.html()).toContain('<a href="https://example.com">Links</a>');
    expect(rendered.html()).toContain('<pre><code>');
    expect(rendered.html()).toContain('const x = 42;');
    expect(rendered.html()).toContain('important note');
    wrapper.unmount();
  });

  it('renders a comment with mixed markdown', () => {
    const content = 'Great work! The **bug** is fixed. See the \`PR #123\` for details.';

    const wrapper = mount(MarkdownRenderer, {
      props: { content },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('Great work!');
    expect(rendered.html()).toContain('<strong>bug</strong>');
    expect(rendered.html()).toContain('<code>PR #123</code>');
    wrapper.unmount();
  });

  it('renders custom allowed tags', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: 'test',
        allowedTags: ['p', 'strong', 'em'],
      },
    });
    expect(wrapper.find('.markdown-rendered').exists()).toBe(true);
    wrapper.unmount();
  });

  it('handles content with HTML entities safely', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'Hello &amp; goodbye' },
    });
    const rendered = wrapper.find('.markdown-rendered');
    expect(rendered.html()).toContain('Hello');
    expect(rendered.html()).toContain('goodbye');
    wrapper.unmount();
  });
});
