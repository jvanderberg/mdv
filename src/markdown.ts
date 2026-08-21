import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { displayCodeLanguage, resolveHighlightLanguage } from "./codeBlocks";
import type { TocHeading } from "./types";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("go", go);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("toml", ini);
hljs.registerLanguage("yaml", yaml);

export interface RenderedDocument {
  html: string;
  toc: TocHeading[];
  blocks: string[];
}

export interface RenderMarkdownOptions {
  loadRemoteImages?: boolean;
  typographer?: boolean;
}

export function renderMarkdown(
  markdown: string,
  { loadRemoteImages = false, typographer = true }: RenderMarkdownOptions = {},
): RenderedDocument {
  const normalizedMarkdown = normalizeHtmlImageTags(markdown);
  const toc: TocHeading[] = [];
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer,
    highlight(code, lang) {
      const language = resolveHighlightLanguage(lang);
      const displayLanguage = displayCodeLanguage(lang);
      const highlighted = language
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : escapeHtml(code);
      return `<pre class="code-block" data-mdv-code-language="${escapeAttr(displayLanguage)}"><code class="hljs language-${escapeAttr(language ?? "plain")}">${highlighted}</code></pre>`;
    },
  });

  const defaultRender =
    md.renderer.rules.heading_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultImageRender =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const rawLanguage = displayCodeLanguage(token.info);
    const language = resolveHighlightLanguage(token.info);
    const highlighted = language
      ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value
      : escapeHtml(token.content);
    const blockIndex = token.attrGet("data-mdv-block-index") ?? "";
    const blockAttr = blockIndex ? ` data-mdv-block-index="${escapeAttr(blockIndex)}"` : "";
    return `<div class="mdv-code-block" data-code-block-id="code-${idx}-${escapeAttr(blockIndex)}" data-code-language="${escapeAttr(rawLanguage)}"${blockAttr}>
<div class="mdv-code-chrome"><span class="mdv-code-language">${escapeHtml(rawLanguage)}</span><div class="mdv-code-toolbar">${codeButtonMarkup("wrap", "Wrap long lines", "text.append")}${codeButtonMarkup("copy", "Copy code", "doc.on.doc")}</div></div>
<pre class="code-block" data-mdv-code-language="${escapeAttr(rawLanguage)}"><code class="hljs language-${escapeAttr(language ?? "plain")}">${highlighted}</code></pre>
</div>`;
  };

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const text = headingText(tokens, idx);
    const level = Number(tokens[idx].tag.slice(1));
    const id = slugifyHeading(
      text,
      toc.map((heading) => heading.id),
    );
    const blockIndex = blockIndexForOffset(normalizedMarkdown, tokens[idx].map?.[0] ?? 0);
    toc.push({ id, level, text, blockIndex });
    tokens[idx].attrSet("id", id);
    return defaultRender(tokens, idx, options, env, self);
  };

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    const alt = token.content;
    if (isDataImage(src)) {
      token.attrSet("class", classList(token.attrGet("class"), "mdv-image"));
      token.attrSet("data-image-state", "loaded");
      return defaultImageRender(tokens, idx, options, env, self);
    }
    if (src.startsWith("data:")) {
      return imagePlaceholder("image not found: inline data:", "missing");
    }
    if (isRemoteImage(src)) {
      if (loadRemoteImages) {
        token.attrSet("class", classList(token.attrGet("class"), "mdv-image"));
        token.attrSet("alt", alt);
        return defaultImageRender(tokens, idx, options, env, self);
      }
      return `<span class="mdv-image-placeholder mdv-image-placeholder-remote" data-image-state="remote-blocked"><strong>Remote image blocked</strong><span>${escapeHtml(remoteLabel(src))}</span></span>`;
    }
    token.attrSet("class", classList(token.attrGet("class"), "mdv-image"));
    token.attrSet("data-mdv-local-image", src);
    token.attrSet("src", transparentPixel);
    token.attrSet("alt", alt);
    return defaultImageRender(tokens, idx, options, env, self);
  };

  md.core.ruler.after("block", "mdv_block_index", (state) => {
    for (const token of state.tokens) {
      if (token.level !== 0 || !token.map || token.nesting === -1 || token.type === "inline") {
        continue;
      }
      token.attrSet(
        "data-mdv-block-index",
        String(blockIndexForOffset(normalizedMarkdown, token.map[0] ?? 0)),
      );
    }
  });

  const html = md.render(normalizedMarkdown);
  return { html, toc, blocks: splitBlocks(markdown) };
}

export function splitBlocks(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function bookmarkFingerprint(block: string): string {
  return block.split(/\s+/).filter(Boolean).join(" ").toLowerCase().slice(0, 80);
}

export function resolveBookmarkAnchor(
  blocks: string[],
  storedIndex: number,
  fingerprint: string,
): number {
  if (blocks.length === 0) return 0;
  if (fingerprint) {
    const exact = blocks.findIndex((block) => bookmarkFingerprint(block) === fingerprint);
    if (exact >= 0) return exact;
  }
  return Math.max(0, Math.min(storedIndex, blocks.length - 1));
}

export function findBlockMatches(blocks: string[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: number[] = [];
  blocks.forEach((block, index) => {
    if (block.toLowerCase().includes(q)) matches.push(index);
  });
  return matches;
}

export function canInlineHighlightMarkdownBlock(block: string): boolean {
  const trimmed = block.trim();
  if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) return false;
  const lines = trimmed.split("\n");
  if (
    lines.length >= 2 &&
    lines[0].includes("|") &&
    [...lines[1]].every((char) => "-:| ".includes(char))
  ) {
    return false;
  }
  if (trimmed.includes("![")) return false;
  return true;
}

function headingText(tokens: Token[], headingOpenIndex: number): string {
  const inline = tokens[headingOpenIndex + 1];
  if (inline?.type !== "inline") return "";
  return inline.content;
}

export function slugifyHeading(text: string, existingIds: string[] = []): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s_-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[-_]+$/g, "") || "heading";
  const existing = new Set(existingIds);
  let id = base;
  let i = 2;
  while (existing.has(id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  return id;
}

function blockIndexForOffset(markdown: string, line: number): number {
  const before = markdown.split("\n").slice(0, line).join("\n");
  return Math.max(0, splitBlocks(before).length);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function normalizeHtmlImageTags(markdown: string): string {
  return markdown.replace(/<img\b[^>]*>/gi, (tag) => {
    const attrs = parseHtmlAttributes(tag);
    const src = attrs.get("src")?.trim();
    if (!src) return tag;
    const alt = attrs.get("alt") ?? "";
    const title = attrs.get("title");
    const destination = `<${src.replace(/>/g, "%3E")}>`;
    return title
      ? `![${escapeMarkdownLabel(alt)}](${destination} "${escapeMarkdownTitle(title)}")`
      : `![${escapeMarkdownLabel(alt)}](${destination})`;
  });
}

function parseHtmlAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const source = tag.replace(/^<img\b/i, "").replace(/\/?>$/i, "");
  const attrPattern = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match = attrPattern.exec(source);
  while (match !== null) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    match = attrPattern.exec(source);
  }
  return attrs;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const transparentPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function isRemoteImage(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function isDataImage(src: string): boolean {
  if (!src.startsWith("data:image/")) return false;
  const comma = src.indexOf(",");
  if (comma < 0) return false;
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  if (meta.includes(";base64")) return /^[a-z0-9+/=\s]+$/i.test(payload) && payload.trim() !== "";
  return payload.trim() !== "";
}

function remoteLabel(src: string): string {
  try {
    return new URL(src).host || src;
  } catch {
    return src;
  }
}

function imagePlaceholder(label: string, state: string): string {
  return `<span class="mdv-image-placeholder" data-image-state="${escapeAttr(state)}">${escapeHtml(label)}</span>`;
}

function codeButtonMarkup(action: "copy" | "wrap", label: string, symbol: string): string {
  return `<button class="mdv-code-button" type="button" data-code-action="${action}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${codeIconMarkup(symbol)}</button>`;
}

function codeIconMarkup(symbol: string): string {
  const paths: Record<string, string> = {
    "doc.on.doc":
      '<path d="M8.25 7.25h8.5v11.5h-8.5V7.25Z" /><path d="M5.25 15.75V4.25h8.5M5.25 4.25h8.5v3" />',
    "text.append":
      '<path d="M5 7h14M5 11h10M5 15h14M5 19h8" /><path d="m17 16.25 2.75 2.75L17 21.75" />',
  };
  return `<svg aria-hidden="true" class="mdv-symbol" data-sf-symbol="${escapeAttr(symbol)}" viewBox="0 0 24 24">${paths[symbol] ?? ""}</svg>`;
}

function classList(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next;
}
