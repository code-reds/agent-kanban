<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface Props {
  /** Raw Markdown content to render */
  content: string;
  /** Block-level tags to sanitize */
  allowedTags?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  allowedTags: () => [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'b', 'i', 'u', 's', 'strong', 'em', 'del', 'code',
    'a', 'img',
    'ul', 'ol', 'li', 'blockquote',
    'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'br',
    'p',
  ],
});

/**
 * Parse Markdown and sanitize the HTML output.
 * Uses `marked` for GFM parsing and `DOMPurify` for XSS sanitization.
 */
const renderedMarkdown = computed(() => {
  if (!props.content || !props.content.trim()) return '';

  try {
    // Configure marked for GFM (GitHub Flavored Markdown)
    marked.setOptions({ gfm: true });
    // marked.parse() returns string | Promise<string> per its type definitions.
    // In sync mode (no custom lexer/parser), it always returns a string.
    const html = String(marked.parse(props.content));
    // Sanitize to prevent XSS
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: props.allowedTags,
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel', 'align', 'class'],
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  } catch {
    // Fallback: return plain text if parsing fails
    return DOMPurify.sanitize(props.content, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
    });
  }
});

const hasContent = computed(() => !!props.content && props.content.trim().length > 0);
</script>

<template>
  <div v-if="hasContent" class="markdown-rendered" v-html="renderedMarkdown" />
  <span v-else class="markdown-empty" />
</template>

<style scoped>
/* Markdown-rendered content styles matching the project design system */
.markdown-rendered {
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
  word-wrap: break-word;
}

/* Headings */
.markdown-rendered :deep(h1),
.markdown-rendered :deep(h2),
.markdown-rendered :deep(h3),
.markdown-rendered :deep(h4),
.markdown-rendered :deep(h5),
.markdown-rendered :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.3;
}

.markdown-rendered :deep(h1) { font-size: 20px; }
.markdown-rendered :deep(h2) { font-size: 17px; }
.markdown-rendered :deep(h3) { font-size: 16px; }

/* Paragraphs */
.markdown-rendered :deep(p) {
  margin: 0 0 8px;
}

.markdown-rendered :deep(p:last-child) {
  margin-bottom: 0;
}

/* Links */
.markdown-rendered :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-rendered :deep(a:hover) {
  color: var(--color-primary-hover);
}

/* Bold & italic */
.markdown-rendered :deep(strong) {
  font-weight: 600;
}

.markdown-rendered :deep(em) {
  font-style: italic;
}

/* Code blocks */
.markdown-rendered :deep(pre) {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-rendered :deep(code) {
  font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
  font-size: 0.9em;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--color-text);
}

.markdown-rendered :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  color: var(--color-text);
}

/* Blockquotes */
.markdown-rendered :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--color-primary);
  color: var(--color-text-secondary);
  background: var(--color-bg);
}

/* Lists */
.markdown-rendered :deep(ul),
.markdown-rendered :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-rendered :deep(li) {
  margin: 2px 0;
}

.markdown-rendered :deep(li > p) {
  margin: 4px 0;
}

/* Horizontal rule */
.markdown-rendered :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 16px 0;
}

/* Tables */
.markdown-rendered :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.markdown-rendered :deep(th) {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 2px solid var(--color-border);
  background: var(--color-bg);
}

.markdown-rendered :deep(td) {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.markdown-rendered :deep(tr:nth-child(even)) {
  background: var(--color-bg);
}
</style>
