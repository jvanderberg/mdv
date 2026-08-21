import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../tests/parity/fixtures.json";
import {
  bookmarkFingerprint,
  canInlineHighlightMarkdownBlock,
  findBlockMatches,
  renderMarkdown,
  resolveBookmarkAnchor,
  slugifyHeading,
  splitBlocks,
} from "./markdown";

describe("markdown parity contract", () => {
  for (const fixture of manifest.documents) {
    it(`renders ${fixture.path}`, () => {
      const markdown = readFixture(fixture.path);
      for (const text of fixture.mustContain) {
        expect(markdown).toContain(text);
      }

      const rendered = renderMarkdown(markdown);
      expect(rendered.blocks.length).toBeGreaterThanOrEqual(fixture.minBlocks);
      expect(rendered.toc.length).toBeGreaterThanOrEqual(fixture.minHeadings);
      expect(rendered.html).toContain("<h1");
      expect(rendered.html).not.toContain("<script");
    });
  }

  it("extracts stable unique heading anchors for duplicate headings", () => {
    const rendered = renderMarkdown("# Intro\n\n## Repeat\n\n## Repeat\n");
    expect(rendered.toc.map((h) => h.id)).toEqual(["intro", "repeat", "repeat-2"]);
  });

  it("marks rendered top-level blocks with mdv block indices", () => {
    const rendered = renderMarkdown("# Intro\n\nParagraph.\n\n> Quote");
    expect(rendered.html).toContain('data-mdv-block-index="0"');
    expect(rendered.html).toContain('data-mdv-block-index="1"');
    expect(rendered.html).toContain('data-mdv-block-index="2"');
  });

  it("matches mdv fragment slug rules", () => {
    expect(slugifyHeading(" Markdown links (in-app navigation) ")).toBe(
      "markdown-links-in-app-navigation",
    );
    expect(slugifyHeading("Keeps_under-score and dash -_")).toBe("keeps_under-score-and-dash");
    expect(slugifyHeading("Repeat", ["repeat"])).toBe("repeat-2");
  });

  it("keeps bookmark anchors stable across small edits", () => {
    const original = splitBlocks("# Title\n\nParagraph with a durable anchor.\n\nLast block");
    const edited = splitBlocks(
      "# Title\n\nInserted block.\n\nParagraph with a durable anchor.\n\nLast block",
    );
    const fingerprint = bookmarkFingerprint(original[1]);

    expect(resolveBookmarkAnchor(edited, 1, fingerprint)).toBe(2);
    expect(resolveBookmarkAnchor(edited, 99, "missing")).toBe(3);
  });

  it("finds block-level matches using the same viewer granularity as bookmarks", () => {
    const blocks = splitBlocks("# Title\n\nAlpha needle.\n\nBeta.\n\nAnother needle.");
    expect(findBlockMatches(blocks, "needle")).toEqual([1, 3]);
    expect(findBlockMatches(blocks, "")).toEqual([]);
  });

  it("matches mdv inline find highlight eligibility", () => {
    expect(canInlineHighlightMarkdownBlock("# Heading with needle")).toBe(true);
    expect(canInlineHighlightMarkdownBlock("> Quote with needle")).toBe(true);
    expect(canInlineHighlightMarkdownBlock("- List needle")).toBe(true);
    expect(canInlineHighlightMarkdownBlock("```ts\nconst needle = true;\n```")).toBe(false);
    expect(canInlineHighlightMarkdownBlock("| A |\n| - |\n| needle |")).toBe(false);
    expect(canInlineHighlightMarkdownBlock("![needle](image.png)")).toBe(false);
  });

  it("syntax fixture exercises every declared language", () => {
    const markdown = readFixture("test-docs/code.md");
    for (const language of manifest.features.codeLanguages) {
      expect(markdown.toLowerCase()).toContain(`\`\`\`${language}`);
    }
    const html = renderMarkdown(markdown).html;
    expect(html).toContain("code-block");
    expect(html).toContain("hljs");
  });

  it("classifies image sources like mdv's local image provider", () => {
    const html = renderMarkdown(
      [
        "![local](images/icon.png)",
        "![remote](https://example.com/tracker.png)",
        "![data](data:image/png;base64,AAAA)",
        "![bad](data:image/png;base64,)",
      ].join("\n\n"),
    ).html;

    expect(html).toContain('data-mdv-local-image="images/icon.png"');
    expect(html).toContain("Remote image blocked");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("image not found: inline data:");
  });
});

function readFixture(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
