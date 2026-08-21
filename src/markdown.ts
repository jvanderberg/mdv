import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { TocHeading } from "./types";

export interface RenderedDocument {
  html: string;
  toc: TocHeading[];
  blocks: string[];
}

export function renderMarkdown(markdown: string): RenderedDocument {
  const toc: TocHeading[] = [];
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(code, lang) {
      const language = resolveHighlightLanguage(lang);
      const highlighted = language
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : escapeHtml(code);
      return `<pre class="code-block"><code class="hljs language-${escapeAttr(language ?? "plain")}">${highlighted}</code></pre>`;
    },
  });

  const defaultRender =
    md.renderer.rules.heading_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultImageRender =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const text = headingText(tokens, idx);
    const level = Number(tokens[idx].tag.slice(1));
    const id = slugifyHeading(
      text,
      toc.map((heading) => heading.id),
    );
    const blockIndex = blockIndexForOffset(markdown, tokens[idx].map?.[0] ?? 0);
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
      return defaultImageRender(tokens, idx, options, env, self);
    }
    if (src.startsWith("data:")) {
      return imagePlaceholder("image not found: inline data:", "missing");
    }
    if (isRemoteImage(src)) {
      return `<span class="mdv-image-placeholder mdv-image-placeholder-remote" data-image-state="remote-blocked"><strong>Remote image blocked</strong><span>${escapeHtml(remoteLabel(src))}</span></span>`;
    }
    token.attrSet("class", classList(token.attrGet("class"), "mdv-image"));
    token.attrSet("data-mdv-local-image", src);
    token.attrSet("src", transparentPixel);
    token.attrSet("alt", alt);
    return defaultImageRender(tokens, idx, options, env, self);
  };

  const html = md.render(markdown);
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

function resolveHighlightLanguage(lang?: string): string | undefined {
  const raw = lang?.trim().toLowerCase().split(/\s+/, 1)[0];
  if (!raw) return undefined;
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    sh: "bash",
    zsh: "bash",
    shell: "bash",
    py: "python",
    rb: "ruby",
    rs: "rust",
    yml: "yaml",
  };
  const normalized = aliases[raw] ?? raw;
  return hljs.getLanguage(normalized) ? normalized : undefined;
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

function classList(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next;
}
