import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";

interface FixtureManifest {
  documents: Array<{
    path: string;
    mustContain: string[];
    minHeadings: number;
    minBlocks: number;
  }>;
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/parity/fixtures.json"), "utf8"),
) as FixtureManifest;

const docs = Object.fromEntries(
  manifest.documents.map((fixture) => [
    abs(fixture.path),
    {
      path: abs(fixture.path),
      filename: fixture.path.split("/").at(-1) ?? fixture.path,
      content: readFileSync(resolve(process.cwd(), fixture.path), "utf8"),
    },
  ]),
);
const directories = {
  [abs("test-docs")]: manifest.documents.map((fixture) => abs(fixture.path)).sort(),
};
const imagePaths = [
  abs("test-docs/images/icon.png"),
  abs("test-docs/images/banner.png"),
  abs("test-docs/images/sample.png"),
  abs("test-docs/images/portrait.png"),
];

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
  await page.route("**/__mdv_asset**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path");
    if (!path || !imagePaths.includes(path)) {
      await route.fulfill({ status: 404, body: "missing" });
      return;
    }
    await route.fulfill({
      body: readFileSync(path),
      contentType: "image/png",
    });
  });
});

test("opens a markdown file, renders document chrome, and builds a TOC", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );

  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText("mdv Test Docs");

  await ensureInspector(page);
  await expect(page.getByTestId("toc").getByRole("button", { name: "What's here" })).toBeVisible();
});

test("filters the table of contents inside the inspector", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );
  await ensureInspector(page);

  await page.getByRole("button", { name: "Filter headings" }).click();
  await page.getByTestId("toc-filter").fill("palette");

  await expect(
    page.getByTestId("toc").getByRole("button", { name: "Palette catalogue" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("toc").getByRole("button", { name: "Verify the TOC pane" }),
  ).toHaveCount(0);
});

test("table of contents pane scrolls independently for long documents", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );
  await ensureInspector(page);

  const toc = page.getByTestId("toc");
  expect(await toc.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const viewerScrollBefore = await page
    .getByTestId("viewer-scroll")
    .evaluate((element) => element.scrollTop);

  await toc.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(async () => toc.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(toc.getByRole("button", { name: "tree-sitter grammar authors" })).toBeVisible();
  await expect
    .poll(async () => page.getByTestId("viewer-scroll").evaluate((element) => element.scrollTop))
    .toBe(viewerScrollBefore);
});

test("table of contents clicks participate in back and forward navigation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );
  await ensureInspector(page);

  const viewer = page.getByTestId("viewer-scroll");
  const before = await viewer.evaluate((element) => element.scrollTop);
  await page.getByTestId("toc").getByRole("button", { name: "Palette catalogue" }).click();
  await expect(page.getByTestId("markdown-body")).toHaveAttribute(
    "data-current-fragment",
    "palette-catalogue",
  );
  await expect
    .poll(async () => viewer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before);

  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByTestId("markdown-body")).not.toHaveAttribute("data-current-fragment");
  await expect.poll(async () => viewer.evaluate((element) => element.scrollTop)).toBeLessThan(64);

  await page.keyboard.press("Meta+ArrowRight");
  await expect(page.getByTestId("markdown-body")).toHaveAttribute(
    "data-current-fragment",
    "palette-catalogue",
  );
});

test("clicking a heading copies that source markdown section", async ({ page }) => {
  await mockClipboard(page);
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );

  const heading = page.getByRole("heading", { name: "What’s here" });
  await heading.click();

  await expect
    .poll(async () => page.evaluate(() => window.__MDV_CLIPBOARD__ ?? ""))
    .toContain("## What's here");
  const copied = await page.evaluate(() => window.__MDV_CLIPBOARD__ ?? "");
  expect(copied).toContain("[syntax.md](syntax.md)");
  expect(copied).not.toContain("## Quick checklist");
  await expect(heading).toHaveClass(/mdv-heading-copy-flash/);
});

test("search pods and bookmarks collapse with animated mdv panels", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  await page.getByRole("button", { name: "Search history" }).click();
  await expect(page.getByTestId("history-search-pod")).toHaveAttribute("data-open", "true");
  await expect(page.getByTestId("history-search-pod")).toHaveCSS(
    "transition-duration",
    /0\.(18|2)s/,
  );

  await ensureInspector(page);
  await page.getByRole("button", { name: "Filter headings" }).click();
  await expect(page.getByTestId("toc-search-pod")).toHaveAttribute("data-open", "true");
  await expect(page.getByTestId("toc-search-pod")).toHaveCSS("transition-duration", /0\.(18|2)s/);

  await ensureBookmarksExpanded(page);
  await page.getByTestId("bookmarks").getByRole("button", { name: "Bookmarks" }).click();
  await expect(page.getByTestId("bookmarks-collapse")).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("bookmarks-collapse")).toHaveCSS(
    "transition-duration",
    /0\.(18|2)s/,
  );
});

test("inspector typography and spacing match the Swift pane", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await ensureInspector(page);

  const heading = page.getByRole("heading", { name: "On This Page" });
  await expect(heading).toHaveCSS("font-size", "11px");
  await expect(heading).toHaveCSS("letter-spacing", "0.6px");
  const tocRow = page.getByTestId("toc").getByRole("button", { name: "What's here" });
  await expect(tocRow).toHaveCSS("font-size", "12px");
  await expect(tocRow).toHaveCSS("min-height", "26px");
  await expect(tocRow).toHaveCSS("border-radius", "5px");
  const tocMetrics = await page.getByTestId("toc").evaluate((toc) => {
    const row = toc.querySelector("button");
    return {
      paneHeight: toc.getBoundingClientRect().height,
      rowHeight: row?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(tocMetrics.rowHeight).toBeLessThanOrEqual(32);
  if (tocMetrics.paneHeight > 120) {
    expect(tocMetrics.rowHeight).toBeLessThan(tocMetrics.paneHeight / 3);
  }

  await page.getByRole("button", { name: "Filter headings" }).click();
  const search = page.locator(".mdv-inspector-search");
  await expect(search).toHaveCSS("border-radius", "6px");
  await expect(search.locator("input")).toHaveCSS("font-size", "12px");

  await ensureBookmarksExpanded(page);
  await page.getByTestId("bookmarks").getByRole("button", { name: "Bookmarks" }).click();
  await expect(page.getByTestId("bookmarks").getByRole("button", { name: "Bookmarks" })).toHaveCSS(
    "height",
    "32px",
  );
  await expect(page.getByTestId("bookmarks-resizer")).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("bookmarks-resizer")).toHaveCSS("height", "0px");
});

test("tracks the active heading in the table of contents", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );
  await ensureInspector(page);

  await page.getByTestId("viewer-scroll").evaluate((scroller) => {
    const target = document.getElementById("active-block-tracking");
    if (!target) throw new Error("missing active-block-tracking heading");
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scroller.scrollTo(0, scroller.scrollTop + targetRect.top - scrollerRect.top - 12);
  });
  await expect(
    page.getByTestId("toc").getByRole("button", { name: "Active-block tracking" }),
  ).toHaveAttribute("aria-current", "location");
});

test("opens a folder selection by preferring README and seeding sibling history", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path), [abs("test-docs")]);

  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText("mdv Test Docs");
  await expect(page.getByTestId("history-list")).toContainText("code.md");
  await expect(page.getByTestId("history-list")).toContainText("README.md");
});

test("opens dropped markdown files and folders", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_DROP_PATHS__?.([path]),
    [abs("test-docs/syntax.md")],
  );
  await expect(page.getByText("syntax.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText(
    "Markdown Syntax Tour",
  );

  await page.evaluate(async ([path]) => window.__MDV_DROP_PATHS__?.([path]), [abs("test-docs")]);
  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByTestId("history-list")).toContainText("code.md");
});

test("opens pending and runtime native open requests", async ({ page }) => {
  await page.addInitScript(
    ([path]) => {
      window.__MDV_PENDING_OPEN_PATHS__ = [path];
    },
    [abs("test-docs/prose.md")],
  );
  await page.goto("/");
  await expect(page.getByText("prose.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText(
    "On Reading Long-Form on a Glowing Rectangle",
  );

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_PATHS__?.([path]),
    [abs("test-docs/links.md")],
  );
  await expect(page.getByText("links.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText("Link Behavior");
});

test("local links navigate inline while external links fall through", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/links.md")],
  );

  const syntaxLink = page.getByRole("link", { name: "Syntax tour" });
  await syntaxLink.dispatchEvent("click");
  await expect(page.getByText("syntax.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText(
    "Markdown Syntax Tour",
  );

  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByText("links.md").first()).toBeVisible();
  const edgeCasesLink = page.getByRole("link", { name: /Edge cases/ });
  await edgeCasesLink.dispatchEvent("click");
  await expect(page.getByTestId("markdown-body")).toHaveAttribute(
    "data-current-fragment",
    "edge-cases",
  );

  const externalLink = page.getByRole("link", { name: "Apple developer docs" });
  await externalLink.dispatchEvent("click");
  await expect(page.getByText("links.md").first()).toBeVisible();
  let calls = await page.evaluate(() => window.__MDV_EXTERNAL_CALLS__ ?? []);
  expect(calls).toContain("https://developer.apple.com/documentation/swiftui");

  await page.getByRole("link", { name: "The icon image" }).dispatchEvent("click");
  await expect(page.getByText("links.md").first()).toBeVisible();
  calls = await page.evaluate(() => window.__MDV_EXTERNAL_CALLS__ ?? []);
  expect(calls).toContain(abs("test-docs/images/icon.png"));

  await page.getByRole("link", { name: "Hypothetical .markdown file" }).dispatchEvent("click");
  await expect(page.getByText("links.md").first()).toBeVisible();
  calls = await page.evaluate(() => window.__MDV_EXTERNAL_CALLS__ ?? []);
  expect(calls).toContain(abs("test-docs/does-not-exist.markdown"));

  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByTestId("markdown-body")).not.toHaveAttribute("data-current-fragment");
  await page.keyboard.press("Meta+ArrowRight");
  await expect(page.getByTestId("markdown-body")).toHaveAttribute(
    "data-current-fragment",
    "edge-cases",
  );
});

test("back and forward restore document snapshots by visible block", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/links.md")],
  );

  const viewer = page.getByTestId("viewer-scroll");
  await page
    .locator("[data-mdv-block-index='3']")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await viewer.evaluate((element) => element.dispatchEvent(new Event("scroll")));

  await page.getByRole("link", { name: "Syntax tour" }).dispatchEvent("click");
  await expect(page.getByText("syntax.md").first()).toBeVisible();

  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByText("links.md").first()).toBeVisible();
  await expect
    .poll(async () =>
      viewer.evaluate((element) => {
        const block = element.querySelector("[data-mdv-block-index='3']");
        if (!block) return Number.POSITIVE_INFINITY;
        return Math.abs(block.getBoundingClientRect().top - element.getBoundingClientRect().top);
      }),
    )
    .toBeLessThan(32);

  await page.keyboard.press("Meta+ArrowRight");
  await expect(page.getByText("syntax.md").first()).toBeVisible();

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("back"));
  await expect(page.getByText("links.md").first()).toBeVisible();
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("forward"));
  await expect(page.getByText("syntax.md").first()).toBeVisible();
});

test("sidebar search hits and bookmark jumps participate in navigation history", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    async ([first, second, third]) => {
      await window.__MDV_OPEN_DOCUMENT__?.(first);
      await window.__MDV_OPEN_DOCUMENT__?.(second);
      await window.__MDV_OPEN_DOCUMENT__?.(third);
    },
    [abs("test-docs/README.md"), abs("test-docs/prose.md"), abs("test-docs/syntax.md")],
  );

  await page.getByRole("button", { name: "README.md" }).click();
  await expect(page.getByText("README.md").first()).toBeVisible();
  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByText("syntax.md").first()).toBeVisible();

  await page.getByRole("button", { name: "Search history" }).click();
  await page.getByPlaceholder("Search history").fill("glowing");
  await page.locator(".mdv-document-row[data-row-variant='search']").first().click();
  await expect(page.getByText("prose.md").first()).toBeVisible();
  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByText("syntax.md").first()).toBeVisible();

  await clickToolbarBookmark(page);
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("bookmark-slot-1"));
  await expect(page.getByText("syntax.md").first()).toBeVisible();
  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByText("README.md").first()).toBeVisible();
});

test("cross-document fragments open the target document and scroll to the heading", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/links.md")],
  );

  await page.getByRole("link", { name: "Syntax escaping section" }).dispatchEvent("click");

  await expect(page.getByText("syntax.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body")).toHaveAttribute(
    "data-current-fragment",
    "escaping",
  );
  await expect
    .poll(async () =>
      page.getByTestId("viewer-scroll").evaluate((scroller) => {
        const target = document.getElementById("escaping");
        if (!target) return { isVisible: false, scrollTop: 0 };
        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        return {
          isVisible: targetRect.bottom > scrollerRect.top && targetRect.top < scrollerRect.bottom,
          scrollTop: scroller.scrollTop,
        };
      }),
    )
    .toMatchObject({ isVisible: true, scrollTop: expect.any(Number) });
  await expect
    .poll(async () => page.getByTestId("viewer-scroll").evaluate((scroller) => scroller.scrollTop))
    .toBeGreaterThan(1000);
});

test("renders local and data images while blocking remote and missing images", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/images.md")],
  );

  await expect(page.locator("img[data-mdv-local-image]")).toHaveCount(7);
  const loadedImages = page.locator("img[data-image-state='loaded']");
  await expect(loadedImages).toHaveCount(9);
  await expect(page.getByAltText("HTML icon")).toBeVisible();
  await expect(page.getByAltText("tiny pixel")).toBeVisible();
  await expect(page.getByAltText("inline icon")).toBeVisible();
  await expect(page.getByText("Remote image blocked")).toBeVisible();
  await expect(page.getByText("github.githubassets.com")).toBeVisible();
  await expect(page.getByText("image not found: does-not-exist.png")).toBeVisible();
});

test("renders markdown lists with visible native-style markers", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/syntax.md")],
  );

  const unordered = page.getByTestId("markdown-body").locator("ul").first();
  const ordered = page.getByTestId("markdown-body").locator("ol").first();
  await expect(unordered.locator("li", { hasText: "Apples" })).toBeVisible();
  await expect(
    page.getByTestId("markdown-body").locator("ul ul").first().locator("li").filter({
      hasText: "Hachiya (eat soft)",
    }),
  ).toBeVisible();
  await expect(ordered.locator("li", { hasText: "Wash the rice" })).toBeVisible();

  const markerStyles = await page.evaluate(() => {
    const body = document.querySelector("[data-testid='markdown-body']");
    const ul = body?.querySelector("ul");
    const nestedUl = body?.querySelector("ul ul");
    const ol = body?.querySelector("ol");
    return {
      unordered: ul ? getComputedStyle(ul).listStyleType : "",
      nested: nestedUl ? getComputedStyle(nestedUl).listStyleType : "",
      ordered: ol ? getComputedStyle(ol).listStyleType : "",
      padding: ul ? Number.parseFloat(getComputedStyle(ul).paddingLeft) : 0,
    };
  });
  expect(markerStyles).toEqual({
    unordered: "disc",
    nested: "circle",
    ordered: "decimal",
    padding: expect.any(Number),
  });
  expect(markerStyles.padding).toBeGreaterThan(12);
});

test("renders table corpus with readable mdv table styling", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/tables.md")],
  );

  const tables = page.getByTestId("markdown-body").locator("table");
  await expect(tables).toHaveCount(7);

  const basic = tables.first();
  await expect(basic).toHaveCSS("display", "block");
  await expect(basic).toHaveCSS("overflow-x", "auto");
  await expect(basic).toHaveCSS("border-radius", "7px");
  await expect(basic.locator("th").first()).toHaveCSS("font-weight", "600");
  await expect(basic.locator("tbody tr").nth(1).locator("td").first()).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  const alignment = tables.nth(1);
  await expect(alignment.locator("th").nth(0)).toHaveCSS("text-align", "left");
  await expect(alignment.locator("th").nth(1)).toHaveCSS("text-align", "center");
  await expect(alignment.locator("th").nth(2)).toHaveCSS("text-align", "right");

  const formatting = tables.nth(3);
  await expect(formatting.locator("strong", { hasText: "Important point" })).toBeVisible();
  await expect(formatting.locator("code", { hasText: "Bundle.main.url" })).toBeVisible();
  await expect(formatting.getByRole("link", { name: "Click me" })).toBeVisible();

  const wide = tables.nth(5);
  expect(await wide.evaluate((table) => table.scrollWidth > table.clientWidth)).toBe(true);
});

test("renders thematic breaks with smart typography enabled", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/thematic-break.md")],
  );

  const body = page.getByTestId("markdown-body");
  await expect(body.locator("hr")).toHaveCount(5);
  await expect(
    body.getByRole("heading", { level: 2, name: "This is a second-level heading" }),
  ).toBeVisible();
  await expect(body.locator("table")).toBeVisible();
  const text = await body.innerText();
  expect(text).toContain("word — word");
  expect(text).toContain("2020–2025");
  expect(text).toContain("--verbose");
});

test("history search, document find, and bookmarks are automatic workflows", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([first, second]) => {
      await window.__MDV_OPEN_DOCUMENT__?.(first);
      await window.__MDV_OPEN_DOCUMENT__?.(second);
    },
    [abs("test-docs/README.md"), abs("test-docs/syntax.md")],
  );

  await page.getByRole("button", { name: "Search history" }).click();
  await page.getByPlaceholder("Search history").fill("checklist");
  await expect(page.getByTestId("history-list")).toContainText("README.md");
  await expect(page.locator(".mdv-snippet-match")).toContainText("checklist", {
    ignoreCase: true,
  });
  await page
    .getByTestId("history-list")
    .getByRole("button", { name: /^README\.md/ })
    .click();
  await expect(page.getByTestId("document-find")).toHaveValue("checklist");
  await expect(page.locator(".mdv-find-current-block")).toHaveCount(1);
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/syntax.md")],
  );

  await page.keyboard.press("Meta+F");
  await page.getByPlaceholder("Find").fill("blockquote");
  await expect(page.getByText("block matches")).toBeVisible();

  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await expect(page.getByTestId("bookmarks")).toContainText("Syntax");
});

test("history search field stays compact and legible in dark themes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([first, second]) => {
      await window.__MDV_OPEN_DOCUMENT__?.(first);
      await window.__MDV_OPEN_DOCUMENT__?.(second);
    },
    [abs("test-docs/README.md"), abs("test-docs/syntax.md")],
  );

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Charcoal" }).click();
  await page.getByRole("button", { name: "Search history" }).click();

  const field = page.locator(".mdv-pane-search");
  await expect(field).toBeVisible();
  await expect(field).toHaveCSS("border-radius", "6px");
  await expect(field.locator("input")).toHaveCSS("font-size", "12px");
  await expect(field.locator(".mdv-symbol").first()).toHaveAttribute(
    "data-sf-symbol",
    "magnifyingglass",
  );
  await expect(field.getByRole("button", { name: "Close history search" })).toBeVisible();

  const colors = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    const input = element.querySelector("input");
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      input: input ? getComputedStyle(input).color : "",
    };
  });
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.border).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.input).not.toBe(colors.background);
});

test("document find highlights blocks and scrolls current match by rendered block", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/prose.md")],
  );

  await page.keyboard.press("Meta+F");
  await page.getByPlaceholder("Find").fill("palette");
  await expect(page.locator(".mdv-find-match-block")).toHaveCount(5);
  await expect(page.locator(".mdv-inline-find-match")).toHaveCount(6);
  const firstCurrent = await page
    .locator(".mdv-find-current-block")
    .first()
    .getAttribute("data-mdv-block-index");
  expect(firstCurrent).toBe("5");
  await expect(page.locator(".mdv-find-current-block .mdv-inline-find-match")).toHaveCount(1);

  await page.getByRole("button", { name: "Next match" }).click();
  const current = page.locator(".mdv-find-current-block").first();
  await expect(current).toHaveAttribute("data-mdv-block-index", "9");
  await expect(page.locator(".mdv-find-current-block .mdv-inline-find-match")).toHaveText(
    "palette",
    { ignoreCase: true },
  );
  await expect
    .poll(async () =>
      page.getByTestId("viewer-scroll").evaluate((element) => {
        const block = element.querySelector(".mdv-find-current-block");
        if (!block) return Number.POSITIVE_INFINITY;
        return Math.abs(block.getBoundingClientRect().top - element.getBoundingClientRect().top);
      }),
    )
    .toBeLessThan(80);
});

test("find shortcuts route by focused pane and close with Escape", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );

  await page.getByTestId("viewer-scroll").click();
  await page.keyboard.press("Meta+F");
  await expect(page.getByTestId("document-find")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("document-find")).toHaveCount(0);

  await page.getByRole("button", { name: "Search history" }).click();
  await expect(page.getByPlaceholder("Search history")).toBeFocused();
  await page.keyboard.press("Meta+F");
  await expect(page.getByPlaceholder("Search history")).toBeFocused();
  await expect(page.getByTestId("document-find")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("history-search-pod")).toHaveAttribute("data-open", "false");
});

test("sidebar and bookmark rows preserve Swift visual density", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([first, second]) => {
      await window.__MDV_OPEN_DOCUMENT__?.(first);
      await window.__MDV_OPEN_DOCUMENT__?.(second);
    },
    [abs("test-docs/README.md"), abs("test-docs/syntax.md")],
  );

  const historyRow = page.locator(".mdv-document-row[data-row-variant='history']").first();
  await expect(historyRow).toBeVisible();
  await expect(historyRow.locator(".mdv-row-icon .mdv-symbol")).toHaveCSS("width", "13px");
  await expect(historyRow).toHaveCSS("border-radius", "5px");
  await expect(historyRow.locator("button span").first()).toHaveCSS("font-size", "13px");
  await expect(historyRow.locator(".mdv-truncate-head").first()).toHaveCSS("direction", "rtl");

  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await expect(page.getByTestId("bookmarks")).toContainText("No bookmarks");
  await expect(page.getByTestId("bookmarks")).toContainText("Press ⌘ D at a spot in any file");

  await clickToolbarBookmark(page);
  const bookmarkRow = page.locator(".mdv-document-row[data-row-variant='bookmark']").first();
  await expect(bookmarkRow).toBeVisible();
  await expect(bookmarkRow).toHaveCSS("min-height", "38px");
  await expect(bookmarkRow.locator(".mdv-row-icon .mdv-symbol")).toHaveCSS("width", "11px");
  await expect(bookmarkRow).toContainText("syntax.md");
  await expect(bookmarkRow).not.toContainText(abs("test-docs/syntax.md"));
});

test("left sidebar resizes and collapses through the Swift divider affordance", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );

  const sidebar = page.getByRole("complementary", { name: "History" });
  const sidebarPanel = page.getByTestId("history-panel");
  const resizer = page.getByTestId("sidebar-resizer");
  const sidebarTransition = await sidebarPanel.evaluate((element) => ({
    duration: getComputedStyle(element).transitionDuration,
    property: getComputedStyle(element).transitionProperty,
  }));
  expect(sidebarTransition.property).toContain("opacity");
  expect(sidebarTransition.property).toContain("transform");
  expect(sidebarTransition.duration).toContain("0.22s");
  const initialWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  const box = await resizer.boundingBox();
  if (!box) {
    await expect(resizer).toBeHidden();
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2);
  await page.mouse.up();

  await expect
    .poll(async () => sidebar.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialWidth + 24);
  expect(
    Number(await page.evaluate(() => localStorage.getItem("mdv.sidebarWidth"))),
  ).toBeGreaterThan(initialWidth + 24);

  await resizer.hover();
  await page.getByRole("button", { name: "Hide Sidebar" }).click();
  await expect(sidebar).toHaveCount(0);
  await expect(sidebarPanel).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(async () => sidebarPanel.evaluate((element) => element.getBoundingClientRect().width))
    .toBeLessThan(2);
  await expect
    .poll(async () => sidebarPanel.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe("none");
  await expect(page.getByTestId("sidebar-edge-gutter")).toBeVisible();
  await page.getByRole("button", { name: "Show Sidebar" }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebarPanel).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(async () => sidebarPanel.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(180);
});

test("right inspector collapse uses the animated shell transition", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  const shellTransition = await page
    .getByTestId("app-shell")
    .evaluate((element) => getComputedStyle(element).transitionProperty);
  const inspectorTransition = await page.getByTestId("inspector-panel").evaluate((element) => ({
    duration: getComputedStyle(element).transitionDuration,
    property: getComputedStyle(element).transitionProperty,
  }));
  expect(shellTransition).toContain("grid-template-columns");
  expect(inspectorTransition.property).toContain("opacity");
  expect(inspectorTransition.property).toContain("transform");
  expect(inspectorTransition.duration).toContain("0.22s");

  const initialWidth = await page
    .getByTestId("inspector-panel")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(initialWidth).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Table of contents" }).click();
  await expect(page.getByTestId("inspector-panel")).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(async () =>
      page
        .getByTestId("inspector-panel")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeLessThan(8);
  if ((await page.viewportSize())?.width >= 1024) {
    await expect
      .poll(async () =>
        page
          .getByTestId("inspector-panel")
          .evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe("none");
  }

  await page.getByRole("button", { name: "Table of contents" }).click();
  await expect(page.getByTestId("inspector-panel")).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(async () =>
      page
        .getByTestId("inspector-panel")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(200);
});

test("bookmarks track current selection and can be reordered", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await clickToolbarBookmark(page);
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/syntax.md")],
  );
  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);

  const bookmarkRows = page.locator(".mdv-document-row[data-row-variant='bookmark']");
  await expect(bookmarkRows).toHaveCount(2);
  await expect(bookmarkRows.nth(1)).toHaveAttribute("data-selected", "true");
  const bookmarkMetrics = await page.getByTestId("bookmarks-content").evaluate((content) => {
    const row = content.querySelector(".mdv-document-row");
    return {
      paneHeight: content.getBoundingClientRect().height,
      rowHeight: row?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(bookmarkMetrics.rowHeight).toBeLessThan(bookmarkMetrics.paneHeight / 3);

  const sourceBox = await bookmarkRows.nth(1).boundingBox();
  const targetBox = await bookmarkRows.nth(0).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!sourceBox || !targetBox) return;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 6,
  });
  await expect(
    page.locator(".mdv-document-row[data-row-variant='bookmark'][data-dragging='true']"),
  ).toHaveCount(2);
  await expect(
    page.locator(".mdv-document-row[data-row-variant='bookmark'][data-drop-target='true']").first(),
  ).toBeVisible();
  await page.mouse.up();
  await expect(bookmarkRows.first()).toContainText("Markdown Syntax Tour");

  await bookmarkRows.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Bottom" }).click();
  await expect(bookmarkRows.first()).toContainText("mdv Test Docs");

  await bookmarkRows.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Top" }).click();
  await expect(bookmarkRows.first()).toContainText("Markdown Syntax Tour");

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("bookmark-slot-1"));
  await expect(page.getByText("syntax.md").first()).toBeVisible();
});

test("placeholder appears as a pinned bookmark row and can jump and clear", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  const viewer = page.getByTestId("viewer-scroll");
  await viewer.evaluate((element) => element.scrollTo(0, 520));
  await page.waitForTimeout(150);
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("set-placeholder"));
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);

  const placeholderRow = page.locator(".mdv-document-row[data-row-variant='placeholder']");
  await expect(placeholderRow).toHaveCount(1);
  await expect(placeholderRow).toHaveAttribute("data-selected", "true");
  await expect(placeholderRow).toContainText("toc-stress.md");

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await expect(placeholderRow).toHaveAttribute("data-selected", "false");
  await placeholderRow.getByRole("button").first().click();
  await expect(page.getByText("toc-stress.md").first()).toBeVisible();
  await expect
    .poll(async () => viewer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(300);

  await placeholderRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clear placeholder" }).click();
  await expect(placeholderRow).toHaveCount(0);
  await expect(page.getByTestId("bookmarks")).toContainText("No bookmarks");
});

test("bookmarks pane resizes and persists its height", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);

  const content = page.getByTestId("bookmarks-content");
  const initialHeight = await content.evaluate((element) => element.getBoundingClientRect().height);
  const box = await page.getByTestId("bookmarks-resizer").boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 44);
  await page.mouse.up();

  await expect
    .poll(async () => content.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(initialHeight + 2);
  const storedHeight = await page.evaluate(() =>
    Number(localStorage.getItem("mdv.bookmarksHeight")),
  );
  expect(storedHeight).toBeGreaterThan(initialHeight + 2);
});

test("bookmarks pane scrolls when saved bookmarks overflow", async ({ page }) => {
  await page.goto("/");
  const path = abs("test-docs/README.md");
  await page.evaluate(
    ([documentPath]) => {
      localStorage.setItem("mdv.bookmarksHeight", "120");
      const bookmarks = window.__MDV_BOOKMARKS__;
      if (!bookmarks) return;
      bookmarks.splice(
        0,
        bookmarks.length,
        ...Array.from({ length: 18 }, (_, index) => ({
          id: index + 1,
          path: documentPath,
          title: `Saved place ${index + 1}`,
          sort_order: index,
          created_at: index + 1,
          block_index: 0,
          block_fingerprint: "",
          file_exists: true,
        })),
      );
    },
    [path],
  );
  await page.evaluate(
    async ([documentPath]) => window.__MDV_OPEN_DOCUMENT__?.(documentPath),
    [path],
  );
  await ensureBookmarksExpanded(page);

  const content = page.getByTestId("bookmarks-content");
  await expect(content.getByRole("button", { name: "Saved place 1 README.md" })).toBeVisible();
  expect(await content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => content.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
});

test("shared bookmark changes refresh visible panes across windows", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await expect
    .poll(async () => page.evaluate(() => window.__MDV_SHARED_STATE_SUBSCRIBED__ === true))
    .toBe(true);

  await expect(
    page.getByTestId("bookmarks-content").getByText("Shared Window Bookmark"),
  ).toHaveCount(0);
  await page.evaluate(
    async ([bookmarkPath, historyPath]) => {
      window.__MDV_BOOKMARKS__?.push({
        id: 99,
        path: bookmarkPath,
        title: "Shared Window Bookmark",
        sort_order: 0,
        created_at: Date.now(),
        block_index: 1,
        block_fingerprint: "",
        file_exists: true,
      });
      window.__MDV_HISTORY__?.unshift({
        path: historyPath,
        filename: "links.md",
        added_at: Date.now(),
      });
      await window.__MDV_SHARED_STATE_CHANGED__?.();
    },
    [abs("test-docs/README.md"), abs("test-docs/links.md")],
  );

  await expect(
    page.getByTestId("bookmarks-content").getByText("Shared Window Bookmark"),
  ).toBeVisible();
  await expect(
    page.getByTestId("history-list").getByRole("button", { name: /links\.md/ }),
  ).toBeVisible();
  await expect(page.getByText("README.md").first()).toBeVisible();
});

test("bookmarks and scroll persistence use the top visible rendered block", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "exact top-block geometry is covered by desktop split-view projects",
  );

  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  const viewer = page.getByTestId("viewer-scroll");
  await page
    .locator("[data-mdv-block-index='6']")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(180);
  await viewer.click();
  await page.keyboard.press("Meta+F");
  await page.getByPlaceholder("Find").fill("case-insensitive");
  await clickToolbarBookmark(page);
  const bookmarkIndex = await page.evaluate(() => window.__MDV_BOOKMARKS__?.[0]?.block_index);
  expect(bookmarkIndex).toBe(6);

  await viewer.evaluate((element) => element.dispatchEvent(new Event("scroll")));
  await expect
    .poll(async () =>
      page.evaluate(
        ([path]) => window.__MDV_SCROLL_POSITIONS__?.[path]?.block_index,
        [abs("test-docs/toc-stress.md")],
      ),
    )
    .toBe(6);

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );
  await expect
    .poll(async () =>
      viewer.evaluate((element) => {
        const block = element.querySelector("[data-mdv-block-index='6']");
        if (!block) return Number.POSITIVE_INFINITY;
        return Math.abs(block.getBoundingClientRect().top - element.getBoundingClientRect().top);
      }),
    )
    .toBeLessThan(32);
});

test("history and bookmark deletion workflows update persisted lists", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([first, second]) => {
      await window.__MDV_OPEN_DOCUMENT__?.(first);
      await window.__MDV_OPEN_DOCUMENT__?.(second);
    },
    [abs("test-docs/README.md"), abs("test-docs/syntax.md")],
  );

  await page.evaluate(
    async ([path]) =>
      window.__MDV_TEST_API__?.saveScrollPosition({
        path,
        blockIndex: 3,
        blockFingerprint: "readme",
        scrollTop: 420,
      }),
    [abs("test-docs/README.md")],
  );
  expect(
    await page.evaluate(
      ([path]) => window.__MDV_SCROLL_POSITIONS__?.[path]?.scroll_top,
      [abs("test-docs/README.md")],
    ),
  ).toBe(420);
  await expect(page.getByTestId("history-list")).toContainText("README.md");
  await page
    .locator(".mdv-document-row[data-row-variant='history']")
    .filter({ hasText: "README.md" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from History" }).click();
  await expect(page.getByTestId("history-list")).not.toContainText("README.md");
  await expect
    .poll(async () =>
      page.evaluate(
        ([path]) => window.__MDV_SCROLL_POSITIONS__?.[path],
        [abs("test-docs/README.md")],
      ),
    )
    .toBeUndefined();

  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await expect(page.getByTestId("bookmarks")).toContainText("Syntax");
  await page
    .locator(".mdv-document-row[data-row-variant='bookmark']")
    .filter({ hasText: "Markdown Syntax Tour" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove Bookmark" }).click();
  await expect(page.getByTestId("bookmarks")).toContainText("No bookmarks");

  await page.getByRole("button", { name: "Search history" }).click();
  await expect(page.getByTestId("history-search-pod").getByRole("button")).toHaveCount(1);
  await expect(
    page.getByTestId("history-search-pod").getByRole("button", { name: "Clear" }),
  ).toHaveCount(0);
});

test("missing bookmark rows are dimmed, inert, and removable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    ([path]) => {
      window.__MDV_BOOKMARKS__?.push({
        id: 404,
        path,
        title: "Missing Bookmark",
        sort_order: 0,
        created_at: Date.now(),
        block_index: 0,
        block_fingerprint: "missing",
        file_exists: false,
      });
    },
    [abs("test-docs/missing.md")],
  );
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);

  const missingRow = page.locator(".mdv-document-row[data-row-variant='bookmark']").first();
  await expect(missingRow).toContainText("Missing Bookmark");
  await expect(missingRow).toHaveCSS("opacity", "0.6");
  await missingRow.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Reveal in Finder" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await missingRow.getByRole("button").first().click();
  await expect(page.getByText("README.md").first()).toBeVisible();

  await missingRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove Bookmark" }).click();
  await expect(missingRow).toHaveCount(0);
});

test("history, search hits, and bookmarks can reveal their file in Finder", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([first, second]) => {
      await window.__MDV_OPEN_DOCUMENT__?.(first);
      await window.__MDV_OPEN_DOCUMENT__?.(second);
    },
    [abs("test-docs/README.md"), abs("test-docs/syntax.md")],
  );

  await page
    .locator(".mdv-document-row[data-row-variant='history']")
    .filter({ hasText: "README.md" })
    .click({
      button: "right",
    });
  await page.getByRole("menuitem", { name: "Reveal README.md in Finder" }).click();
  await page.getByRole("button", { name: "Search history" }).click();
  await page.getByPlaceholder("Search history").fill("checklist");
  await page
    .locator(".mdv-document-row[data-row-variant='search']")
    .filter({ hasText: "README.md" })
    .click({
      button: "right",
    });
  await page.getByRole("menuitem", { name: "Reveal README.md in Finder" }).click();
  await page.getByTestId("viewer-scroll").click();
  await page.keyboard.press("Meta+F");
  await page.getByPlaceholder("Find").fill("blockquote");
  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await page
    .locator(".mdv-document-row[data-row-variant='bookmark']")
    .filter({ hasText: "Markdown Syntax Tour" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reveal in Finder" }).click();

  const calls = await page.evaluate(() => window.__MDV_REVEAL_CALLS__ ?? []);
  expect(calls).toEqual([
    abs("test-docs/README.md"),
    abs("test-docs/README.md"),
    abs("test-docs/syntax.md"),
  ]);
});

test("themes and zoom alter durable viewer state without layout collapse", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/prose.md")],
  );

  const initialFontSize = await page
    .locator(".markdown-body")
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Charcoal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "charcoal");
  await page.keyboard.press("Meta+=");
  await expect(page.getByTestId("zoom-hud")).toHaveText("110%");

  const zoomedFontSize = await page
    .locator(".markdown-body")
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(zoomedFontSize)).toBeGreaterThan(parseFloat(initialFontSize));
  await expect(page.getByTestId("markdown-body")).toBeVisible();
  await page.keyboard.press("Meta+-");
  await expect(page.getByTestId("zoom-hud")).toHaveText("100%");
});

test("theme menu exposes the full Swift mdv catalog", async ({ page }) => {
  const expectedThemes = [
    ["system", "System"],
    ["high-contrast", "High Contrast"],
    ["sevilla", "Sevilla"],
    ["charcoal", "Charcoal"],
    ["solarium-daylight", "Solarium Daylight"],
    ["solarium-moonlight", "Solarium Moonlight"],
    ["phosphor", "Phosphor"],
    ["twilight", "Twilight"],
    ["standard-erin-light", "Standard Erin Light"],
    ["standard-erin-dark", "Standard Erin Dark"],
  ] as const;

  await page.goto("/");
  for (const [id, label] of expectedThemes) {
    await page.getByRole("button", { name: "Theme" }).click();
    await expect(page.getByRole("menuitemradio", { name: label })).toBeVisible();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
  }
});

test("theme palette opens below the toolbar and accepts selection", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Theme" }).click();
  const toolbarBox = await page.getByTestId("app-toolbar").boundingBox();
  const menuBox = await page.getByTestId("theme-menu").boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox?.y).toBeGreaterThan((toolbarBox?.y ?? 0) + 24);
  expect(menuBox?.height).toBeGreaterThan(250);

  const charcoal = page.getByRole("menuitemradio", { name: "Charcoal" });
  await expect(charcoal).toBeVisible();
  const charcoalBox = await charcoal.boundingBox();
  if (!charcoalBox) throw new Error("Theme menu item should have a visible bounding box");
  const receivesPointer = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest?.('[role="menuitemradio"]'));
    },
    [charcoalBox.x + charcoalBox.width / 2, charcoalBox.y + charcoalBox.height / 2],
  );
  expect(receivesPointer).toBe(true);

  await charcoal.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "charcoal");
  await expect(page.getByTestId("theme-menu")).toHaveCount(0);
});

test("every Swift mdv theme renders visible document content", async ({ page }) => {
  const expectedThemes = [
    ["system", "System"],
    ["high-contrast", "High Contrast"],
    ["sevilla", "Sevilla"],
    ["charcoal", "Charcoal"],
    ["solarium-daylight", "Solarium Daylight"],
    ["solarium-moonlight", "Solarium Moonlight"],
    ["phosphor", "Phosphor"],
    ["twilight", "Twilight"],
    ["standard-erin-light", "Standard Erin Light"],
    ["standard-erin-dark", "Standard Erin Dark"],
  ] as const;

  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/prose.md")],
  );

  for (const [id, label] of expectedThemes) {
    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await expect(page.getByTestId("markdown-body").locator("h1")).toBeVisible();

    const screenshot = await page.getByTestId("markdown-body").screenshot();
    expect(hasVisiblePixels(screenshot)).toBe(true);
  }
});

test("theme typography follows Swift smart punctuation and weight rules", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/prose.md")],
  );

  await expect(page.getByTestId("markdown-body")).toContainText("“nice serif”");

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Phosphor" }).click();
  await expect(page.getByTestId("markdown-body")).toContainText('"nice serif"');

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Standard Erin Light" }).click();
  await expect(page.getByTestId("markdown-body").locator("h1")).toHaveCSS("font-weight", "400");
  await expect(page.getByTestId("markdown-body").locator("strong").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("markdown-body")).toContainText('"nice serif"');
});

test("code syntax palettes follow the active mdv theme", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/code.md")],
  );

  await expect(page.locator(".hljs-keyword").first()).toHaveCSS("color", "rgb(207, 34, 46)");
  await expect(page.locator(".hljs-comment").first()).toHaveCSS("color", "rgb(110, 119, 129)");
  await expect(page.locator(".hljs-comment").first()).toHaveCSS("font-style", "italic");

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Charcoal" }).click();
  await expect(page.locator(".hljs-keyword").first()).toHaveCSS("color", "rgb(255, 123, 114)");
  await expect(page.locator(".hljs-string").first()).toHaveCSS("color", "rgb(165, 214, 255)");

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Solarium Daylight" }).click();
  await expect(page.locator(".hljs-keyword").first()).toHaveCSS("color", "rgb(133, 153, 0)");
  await expect(page.locator(".hljs-number").first()).toHaveCSS("color", "rgb(211, 54, 130)");
});

test("native menu commands drive mdv workflows", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("toggle-sidebar"));
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-sidebar-visible", "false");
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("toggle-sidebar"));
  await expect(page.getByRole("complementary", { name: "History" })).toBeVisible();

  const viewer = page.getByTestId("viewer-scroll");
  await viewer.evaluate((element) => element.scrollTo(0, 420));
  await page.waitForTimeout(150);
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("set-placeholder"));
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("jump-to-placeholder"));
  await expect(page.getByText("toc-stress.md").first()).toBeVisible();
  await expect
    .poll(async () => viewer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(300);

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("bookmark-current-spot"));
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("bookmark-slot-1"));
  await expect(page.getByText("toc-stress.md").first()).toBeVisible();

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("edit-current-file"));
  const editorCalls = await page.evaluate(() => window.__MDV_EDITOR_CALLS__ ?? []);
  expect(editorCalls.at(-1)).toEqual({
    editorPath: "/Applications/Visual Studio Code.app",
    documentPath: abs("test-docs/toc-stress.md"),
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Command line tool installed");
    await dialog.dismiss();
  });
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("install-cli"));
  await expect
    .poll(async () => page.evaluate(() => window.__MDV_CLI_INSTALL_CALLS__?.length ?? 0))
    .toBe(1);
});

test("native menu state mirrors Swift dynamic labels checks and enables", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__MDV_NATIVE_MENU_STATES__?.at(-1)))
    .toMatchObject({
      hasDocument: false,
      canGoBack: false,
      canGoForward: false,
      sidebarVisible: true,
      smartTypography: true,
      smartTypographyAllowed: true,
      loadRemoteImages: false,
      bookmarkSlots: [
        { title: "Slot 1 — Empty", enabled: false },
        { title: "Slot 2 — Empty", enabled: false },
        { title: "Slot 3 — Empty", enabled: false },
        { title: "Slot 4 — Empty", enabled: false },
        { title: "Slot 5 — Empty", enabled: false },
      ],
    });

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/syntax.md")],
  );
  await clickToolbarBookmark(page);
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("toggle-sidebar"));
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("load-remote-images"));
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Phosphor" }).click();

  await expect
    .poll(async () => page.evaluate(() => window.__MDV_NATIVE_MENU_STATES__?.at(-1)))
    .toMatchObject({
      hasDocument: true,
      sidebarVisible: false,
      smartTypography: true,
      smartTypographyAllowed: false,
      loadRemoteImages: true,
      bookmarkSlots: [
        { title: "Markdown Syntax Tour", enabled: true },
        { title: "Slot 2 — Empty", enabled: false },
        { title: "Slot 3 — Empty", enabled: false },
        { title: "Slot 4 — Empty", enabled: false },
        { title: "Slot 5 — Empty", enabled: false },
      ],
    });
});

test("open in new window keeps the current document and delegates to native window creation", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("open-new-window"));

  await expect(page.getByText("toc-stress.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText("TOC Stress Test");
  await expect
    .poll(async () => page.evaluate(() => window.__MDV_OPEN_NEW_WINDOW_CALLS__ ?? []))
    .toEqual([abs("test-docs/README.md")]);
});

test("external file changes reload the current document without losing scroll", async ({
  page,
}) => {
  await page.goto("/");
  const path = abs("test-docs/toc-stress.md");
  await page.evaluate(
    async ([documentPath]) => window.__MDV_OPEN_DOCUMENT__?.(documentPath),
    [path],
  );

  const viewer = page.getByTestId("viewer-scroll");
  await viewer.evaluate((element) => {
    element.scrollTo(0, 640);
  });
  await page.waitForTimeout(120);
  const before = await viewer.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(300);

  await page.evaluate(
    ([documentPath]) => {
      window.__MDV_REWRITE_DOCUMENT__?.(
        documentPath,
        "# Reloaded Fixture\n\nLive reload landed.\n\n" +
          Array.from({ length: 80 }, (_, index) => `Paragraph ${index} keeps the page tall.`).join(
            "\n\n",
          ),
      );
    },
    [path],
  );

  await expect(page.getByTestId("markdown-body")).toContainText("Live reload landed");
  await expect
    .poll(async () => viewer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before - 40);
});

test("editing the current file keeps it open and reloads editor saves", async ({ page }) => {
  await page.goto("/");
  const path = abs("test-docs/README.md");
  await page.evaluate(
    async ([documentPath]) => window.__MDV_OPEN_DOCUMENT__?.(documentPath),
    [path],
  );

  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText("mdv Test Docs");

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("edit-current-file"));
  await expect
    .poll(async () => page.evaluate(() => window.__MDV_EDITOR_CALLS__ ?? []))
    .toContainEqual({
      editorPath: "/Applications/Visual Studio Code.app",
      documentPath: path,
    });
  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText("mdv Test Docs");

  await page.evaluate(
    ([documentPath]) => {
      window.__MDV_REWRITE_DOCUMENT__?.(
        documentPath,
        "# README Edited In Place\n\nThe external editor save reloaded inside mdv.",
      );
    },
    [path],
  );
  await page.evaluate(
    async ([documentPath]) => window.__MDV_OPEN_PATHS__?.([documentPath]),
    [path],
  );

  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByTestId("markdown-body").locator("h1")).toContainText(
    "README Edited In Place",
  );
  await expect(page.getByTestId("markdown-body")).toContainText(
    "external editor save reloaded inside mdv",
  );
});

test("view menu toggles remote images and smart typography", async ({ page }) => {
  await page.route("https://github.githubassets.com/**", async (route) => {
    await route.fulfill({
      body: readFileSync(abs("test-docs/images/icon.png")),
      contentType: "image/png",
    });
  });
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/images.md")],
  );

  await expect(page.getByText("Remote image blocked")).toBeVisible();
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("load-remote-images"));
  await expect(page.getByText("Remote image blocked")).toHaveCount(0);
  await expect(page.locator("img[src^='https://']")).toHaveCount(1);
  await expect(page.locator("img[src^='https://']")).toHaveAttribute("data-image-state", "loaded");

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/prose.md")],
  );
  await expect(page.getByTestId("markdown-body")).toContainText("“nice serif”");
  await expect(page.getByTestId("markdown-body")).toContainText("invisible-but-present");
  const smartText = await page.getByTestId("markdown-body").innerText();
  expect(smartText).toContain("—");
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("smart-typography"));
  await expect(page.getByTestId("markdown-body")).toContainText('"nice serif"');
  const plainText = await page.getByTestId("markdown-body").innerText();
  expect(plainText).not.toEqual(smartText);
  expect(plainText).not.toContain("“nice serif”");
});

test("enabled remote image failures render an explicit placeholder", async ({ page }) => {
  await page.route("https://github.githubassets.com/**", async (route) => {
    await route.abort();
  });
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/images.md")],
  );

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("load-remote-images"));
  await expect(page.getByText("Couldn't load remote image")).toBeVisible();
  await expect(page.locator("[data-image-state='remote-error']")).toContainText(
    "github.githubassets.com",
  );
});

test("code blocks expose mdv chrome, copy, and per-block wrap", async ({ page }) => {
  await mockClipboard(page);
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/code.md")],
  );

  const firstBlock = page.locator(".mdv-code-block").first();
  await expect(firstBlock.locator(".mdv-code-language")).toHaveText("bash");
  await firstBlock.hover();
  await expect(firstBlock.getByRole("button", { name: "Wrap long lines" })).toBeVisible();
  await expect(firstBlock.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(firstBlock.locator('.mdv-symbol[data-sf-symbol="text.append"]')).toBeVisible();
  await expect(firstBlock.locator('.mdv-symbol[data-sf-symbol="doc.on.doc"]')).toBeVisible();

  await firstBlock.getByRole("button", { name: "Wrap long lines" }).click();
  await expect(firstBlock).toHaveClass(/mdv-code-wrap/);
  await expect(firstBlock.locator('.mdv-symbol[data-sf-symbol="text.alignleft"]')).toBeVisible();

  await firstBlock.getByRole("button", { name: "Copy code" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__MDV_CLIPBOARD__ ?? ""))
    .toContain("swift build -c");
  await expect(firstBlock.locator('.mdv-symbol[data-sf-symbol="checkmark"]')).toBeVisible();
});

test("long code lines scroll until wrap is enabled", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/code-long-line.md")],
  );

  const block = page.locator(".mdv-code-block").first();
  const pre = block.locator("pre.code-block");
  const scrollMetrics = await pre.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);

  await block.hover();
  await block.getByRole("button", { name: "Wrap long lines" }).click();
  await expect
    .poll(async () => pre.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});

test("shell code context menu can copy without prompts", async ({ page }) => {
  await mockClipboard(page);
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/code-prompts.md")],
  );

  const block = page.locator(".mdv-code-block").first();
  await block.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy Code" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Wrap Long Lines" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy Without Prompts" }).click();

  await expect
    .poll(async () => page.evaluate(() => window.__MDV_CLIPBOARD__ ?? ""))
    .toBe("pnpm install\npnpm test\nsystemctl restart mdv\nplain output\n");
});

test("restores the saved scroll position when reopening a document", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  const viewer = page.getByTestId("viewer-scroll");
  await page.waitForTimeout(300);
  const targetScroll = await viewer.evaluate((element) =>
    Math.max(0, Math.min(820, element.scrollHeight - element.clientHeight - 20)),
  );
  expect(targetScroll).toBeGreaterThan(120);
  await viewer.evaluate((element, scrollTop) => {
    element.scrollTo(0, scrollTop);
  }, targetScroll);
  await page.waitForTimeout(250);

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await expect(page.getByText("README.md").first()).toBeVisible();
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  await expect
    .poll(async () => viewer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(targetScroll - 40);
});

test("visual shell stays readable without clipped chrome", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );
  await ensureInspector(page);
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Forward" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);

  const metrics = await page.evaluate(() => {
    const header = document.querySelector("header");
    const article = document.querySelector<HTMLElement>("[data-testid='markdown-body']");
    const heading = article?.querySelector("h1");
    const paragraph = article?.querySelector("p");
    const appToolbar = document.querySelector("[data-testid='app-toolbar']");
    const toolbarButtons = Array.from(appToolbar?.querySelectorAll("button") ?? []);
    const headerRect = header?.getBoundingClientRect();
    const articleRect = article?.getBoundingClientRect();
    const headingRect = heading?.getBoundingClientRect();
    const paragraphRect = paragraph?.getBoundingClientRect();
    const appToolbarRect = appToolbar?.getBoundingClientRect();

    return {
      articleWidth: articleRect?.width ?? 0,
      headerHeight: headerRect?.height ?? 0,
      headingFontSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
      headingHeight: headingRect?.height ?? 0,
      paragraphHeight: paragraphRect?.height ?? 0,
      clippedSidebarControls: toolbarButtons.some((button) => {
        const rect = button.getBoundingClientRect();
        if (!appToolbarRect) return true;
        return (
          rect.left < appToolbarRect.left ||
          rect.right > appToolbarRect.right ||
          button.scrollWidth > button.clientWidth ||
          button.scrollHeight > button.clientHeight
        );
      }),
    };
  });

  const isMobile = testInfo.project.name === "mobile";
  expect(metrics.headerHeight).toBeGreaterThanOrEqual(40);
  expect(metrics.headerHeight).toBeLessThanOrEqual(isMobile ? 150 : 72);
  expect(metrics.articleWidth).toBeGreaterThanOrEqual(isMobile ? 320 : 720);
  expect(metrics.headingFontSize).toBeGreaterThanOrEqual(24);
  expect(metrics.headingHeight).toBeGreaterThanOrEqual(30);
  expect(metrics.paragraphHeight).toBeGreaterThanOrEqual(20);
  expect(metrics.clippedSidebarControls).toBe(false);
});

test("toolbar uses the exact Swift mdv action symbols", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/README.md")],
  );

  const toolbar = page.getByTestId("app-toolbar");
  await expect(toolbar.getByRole("button")).toHaveCount(5);
  const symbols = await toolbar
    .locator(".mdv-symbol")
    .evaluateAll((icons) => icons.map((icon) => icon.getAttribute("data-sf-symbol")));
  expect(symbols).toEqual(["plus", "pencil", "paintpalette", "bookmark", "sidebar.right"]);

  await toolbar.getByRole("button", { name: "Bookmark" }).click();
  const filledSymbols = await toolbar
    .locator(".mdv-symbol")
    .evaluateAll((icons) => icons.map((icon) => icon.getAttribute("data-sf-symbol")));
  expect(filledSymbols).toEqual([
    "plus",
    "pencil",
    "paintpalette",
    "bookmark.fill",
    "sidebar.right",
  ]);
});

for (const fixture of manifest.documents) {
  test(`fixture screenshot is nonblank: ${fixture.path}`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile" && fixture.path.endsWith("toc-stress.md"),
      "large TOC stress fixture is covered on desktop",
    );

    await page.goto("/");
    await page.evaluate(
      async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
      [abs(fixture.path)],
    );
    const screenshot = await page.screenshot({ fullPage: false });
    expect(hasVisiblePixels(screenshot)).toBe(true);
  });
}

async function installMockApi(page: Page) {
  await page.addInitScript(
    ({ directories, docs, imagePaths }) => {
      const history: Array<{ path: string; filename: string; added_at: number }> = [];
      const externalCalls: string[] = [];
      const revealCalls: string[] = [];
      const scrollPositions = new Map<
        string,
        {
          path: string;
          block_index: number;
          block_fingerprint: string;
          scroll_top: number;
        }
      >();
      const scrollPositionSnapshot: Record<
        string,
        {
          path: string;
          block_index: number;
          block_fingerprint: string;
          scroll_top: number;
        }
      > = {};
      let dropHandler: ((paths: string[]) => void | Promise<void>) | undefined;
      let openHandler: ((paths: string[]) => void | Promise<void>) | undefined;
      let menuHandler: ((command: string) => void | Promise<void>) | undefined;
      let sharedStateHandler: (() => void | Promise<void>) | undefined;
      const nativeMenuStates: NonNullable<Window["__MDV_NATIVE_MENU_STATES__"]> = [];
      const pendingDrops: string[][] = [];
      const pendingOpenRequests: string[][] = [];
      const editorCalls: Array<{ editorPath: string; documentPath: string }> = [];
      const cliInstallCalls: string[] = [];
      const openNewWindowCalls: string[] = [];
      const bookmarks: Array<{
        id: number;
        path: string;
        title: string;
        sort_order: number;
        created_at: number;
        block_index: number;
        block_fingerprint: string;
        file_exists: boolean;
      }> = [];
      const signatures: Record<string, { file_mtime_ms: number; file_size: number }> = {};
      for (const [path, doc] of Object.entries(docs)) {
        signatures[path] = { file_mtime_ms: Date.now(), file_size: doc.content.length };
      }
      const snippetFor = (content: string, query: string) => {
        const normalized = content.toLowerCase();
        const needle = query.trim().toLowerCase();
        const index = normalized.indexOf(needle);
        if (index < 0 || needle.length === 0) return content.slice(0, 140);
        const start = Math.max(0, index - 36);
        const end = Math.min(content.length, index + needle.length + 72);
        return `${start > 0 ? "…" : ""}${content.slice(start, index)}\u0002${content.slice(
          index,
          index + needle.length,
        )}\u0003${content.slice(index + needle.length, end)}${end < content.length ? "…" : ""}`;
      };

      window.__MDV_TEST_API__ = {
        async openPath() {
          return Object.keys(docs)[0] ?? null;
        },
        async openPathInNewWindow(path: string) {
          openNewWindowCalls.push(path);
        },
        async openDirectory() {
          return Object.keys(directories)[0] ?? null;
        },
        async chooseEditor() {
          return "/Applications/Visual Studio Code.app";
        },
        async openInEditor(_editorPath: string, _documentPath: string) {
          editorCalls.push({ editorPath: _editorPath, documentPath: _documentPath });
        },
        async installCli() {
          cliInstallCalls.push("install");
          return "Command line tool installed";
        },
        async subscribeToFileDrops(onDrop) {
          dropHandler = onDrop;
          for (const paths of pendingDrops.splice(0, pendingDrops.length)) {
            await onDrop(paths);
          }
          return () => {
            if (dropHandler === onDrop) dropHandler = undefined;
          };
        },
        async subscribeToOpenRequests(onOpen) {
          openHandler = onOpen;
          for (const paths of pendingOpenRequests.splice(0, pendingOpenRequests.length)) {
            await onOpen(paths);
          }
          return () => {
            if (openHandler === onOpen) openHandler = undefined;
          };
        },
        async subscribeToMenuCommands(onCommand) {
          menuHandler = onCommand;
          const listener = (event: Event) => {
            const command = (event as CustomEvent<string>).detail;
            void onCommand(command);
          };
          window.addEventListener("mdv:test-menu-command", listener);
          return () => {
            window.removeEventListener("mdv:test-menu-command", listener);
            if (menuHandler === onCommand) menuHandler = undefined;
          };
        },
        async subscribeToSharedStateChanges(onChange) {
          sharedStateHandler = onChange;
          window.__MDV_SHARED_STATE_SUBSCRIBED__ = true;
          return () => {
            if (sharedStateHandler === onChange) {
              sharedStateHandler = undefined;
              window.__MDV_SHARED_STATE_SUBSCRIBED__ = false;
            }
          };
        },
        async takePendingOpenPaths() {
          const paths = window.__MDV_PENDING_OPEN_PATHS__ ?? [];
          window.__MDV_PENDING_OPEN_PATHS__ = [];
          return paths;
        },
        async openExternalTarget(target: string) {
          externalCalls.push(target);
        },
        async revealPath(path: string) {
          revealCalls.push(path);
        },
        async loadMarkdown(path: string) {
          const paths = directories[path];
          if (paths) {
            const primary =
              paths.find((entry) => {
                const filename = entry.split("/").at(-1) ?? "";
                const stem = filename.split(".").slice(0, -1).join(".");
                return stem.toLowerCase() === "readme";
              }) ?? paths[0];
            for (const sibling of paths.filter((entry) => entry !== primary).reverse()) {
              const siblingDoc = docs[sibling];
              const existing = history.findIndex((entry) => entry.path === sibling);
              if (existing >= 0) history.splice(existing, 1);
              history.unshift({
                path: sibling,
                filename: siblingDoc.filename,
                added_at: Date.now(),
              });
            }
            path = primary;
          }
          const doc = docs[path];
          if (!doc) throw new Error(`missing fixture ${path}`);
          const existing = history.findIndex((entry) => entry.path === path);
          if (existing >= 0) history.splice(existing, 1);
          history.unshift({ path, filename: doc.filename, added_at: Date.now() });
          return { ...doc, ...signatures[path] };
        },
        async fileSignature(path: string) {
          const signature = signatures[path];
          if (!signature) throw new Error(`missing fixture ${path}`);
          return { path, ...signature };
        },
        async resolveLocalImage(documentPath: string, src: string) {
          const path = src.startsWith("/")
            ? src
            : `${documentPath.slice(0, documentPath.lastIndexOf("/"))}/${decodeURIComponent(src)}`;
          return { path, exists: imagePaths.includes(path) };
        },
        localImageUrl(path: string) {
          return `/__mdv_asset?path=${encodeURIComponent(path)}`;
        },
        async loadScrollPosition(path: string) {
          return scrollPositions.get(path) ?? null;
        },
        async saveScrollPosition({ path, blockIndex, blockFingerprint, scrollTop }) {
          const position = {
            path,
            block_index: blockIndex,
            block_fingerprint: blockFingerprint,
            scroll_top: scrollTop,
          };
          scrollPositions.set(path, position);
          scrollPositionSnapshot[path] = position;
        },
        async listHistory() {
          return history.map((entry) => ({ ...entry }));
        },
        async removeHistory(path: string) {
          const existing = history.findIndex((entry) => entry.path === path);
          if (existing >= 0) history.splice(existing, 1);
          scrollPositions.delete(path);
          delete scrollPositionSnapshot[path];
        },
        async clearHistory() {
          history.splice(0, history.length);
          scrollPositions.clear();
          for (const path of Object.keys(scrollPositionSnapshot))
            delete scrollPositionSnapshot[path];
        },
        async searchHistory(query: string) {
          const q = query.toLowerCase();
          return history
            .filter((entry) => docs[entry.path].content.toLowerCase().includes(q))
            .map((entry) => ({
              path: entry.path,
              filename: entry.filename,
              snippet: snippetFor(docs[entry.path].content, query),
            }));
        },
        async addBookmark({ path, title, blockIndex, blockFingerprint }) {
          const bookmark = {
            id: bookmarks.length + 1,
            path,
            title,
            sort_order: bookmarks.length,
            created_at: Date.now(),
            block_index: blockIndex,
            block_fingerprint: blockFingerprint,
            file_exists: true,
          };
          bookmarks.push(bookmark);
          return bookmark;
        },
        async listBookmarks() {
          return bookmarks.map((bookmark) => ({ ...bookmark }));
        },
        async removeBookmark(id: number) {
          const existing = bookmarks.findIndex((bookmark) => bookmark.id === id);
          if (existing >= 0) bookmarks.splice(existing, 1);
          bookmarks.forEach((bookmark, index) => {
            bookmark.sort_order = index;
          });
        },
        async reorderBookmarks(ids: number[]) {
          const reordered = ids
            .map((id) => bookmarks.find((bookmark) => bookmark.id === id))
            .filter((bookmark) => bookmark !== undefined);
          if (reordered.length !== bookmarks.length) throw new Error("invalid bookmark order");
          bookmarks.splice(0, bookmarks.length, ...reordered);
          bookmarks.forEach((bookmark, index) => {
            bookmark.sort_order = index;
          });
          return bookmarks.map((bookmark) => ({ ...bookmark }));
        },
        async updateNativeMenuState(state) {
          nativeMenuStates.push(structuredClone(state));
        },
      };
      window.__MDV_DROP_PATHS__ = async (paths: string[]) => {
        if (dropHandler) await dropHandler(paths);
        else pendingDrops.push(paths);
      };
      window.__MDV_OPEN_PATHS__ = async (paths: string[]) => {
        if (openHandler) await openHandler(paths);
        else pendingOpenRequests.push(paths);
      };
      window.__MDV_MENU_COMMAND__ = async (command: string) => {
        if (menuHandler) await menuHandler(command);
      };
      window.__MDV_SHARED_STATE_CHANGED__ = async () => {
        if (sharedStateHandler) await sharedStateHandler();
      };
      window.__MDV_REWRITE_DOCUMENT__ = (path: string, content: string) => {
        const doc = docs[path];
        if (!doc) throw new Error(`missing fixture ${path}`);
        doc.content = content;
        signatures[path] = {
          file_mtime_ms: (signatures[path]?.file_mtime_ms ?? Date.now()) + 1,
          file_size: content.length,
        };
      };
      window.__MDV_EXTERNAL_CALLS__ = externalCalls;
      window.__MDV_REVEAL_CALLS__ = revealCalls;
      window.__MDV_EDITOR_CALLS__ = editorCalls;
      window.__MDV_CLI_INSTALL_CALLS__ = cliInstallCalls;
      window.__MDV_OPEN_NEW_WINDOW_CALLS__ = openNewWindowCalls;
      window.__MDV_BOOKMARKS__ = bookmarks;
      window.__MDV_HISTORY__ = history;
      window.__MDV_SCROLL_POSITIONS__ = scrollPositionSnapshot;
      window.__MDV_NATIVE_MENU_STATES__ = nativeMenuStates;
    },
    { directories, docs, imagePaths },
  );
}

async function ensureInspector(page: Page) {
  if (
    !(await page
      .getByTestId("toc")
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole("button", { name: "Table of contents" }).click();
  }
}

async function ensureBookmarksExpanded(page: Page) {
  const button = page.getByTestId("bookmarks").getByRole("button", { name: "Bookmarks" });
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }
}

async function mockClipboard(page: Page) {
  await page.addInitScript(() => {
    window.__MDV_CLIPBOARD__ = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.__MDV_CLIPBOARD__ = value;
        },
      },
    });
  });
}

async function clickToolbarBookmark(page: Page) {
  await page.getByTestId("app-toolbar").getByRole("button", { name: "Bookmark" }).click();
}

function abs(path: string) {
  return resolve(process.cwd(), path);
}

function hasVisiblePixels(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  let nonWhite = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a > 0 && (r < 245 || g < 245 || b < 245)) nonWhite += 1;
    if (nonWhite > 500) return true;
  }
  return false;
}
