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
  const calls = await page.evaluate(() => window.__MDV_EXTERNAL_CALLS__ ?? []);
  expect(calls).toContain("https://developer.apple.com/documentation/swiftui");

  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByTestId("markdown-body")).not.toHaveAttribute("data-current-fragment");
  await page.keyboard.press("Meta+ArrowRight");
  await expect(page.getByTestId("markdown-body")).toHaveAttribute(
    "data-current-fragment",
    "edge-cases",
  );
});

test("renders local and data images while blocking remote and missing images", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/images.md")],
  );

  const loadedImages = page.locator("img[data-image-state='loaded']");
  await expect(loadedImages).toHaveCount(6);
  await expect(page.getByAltText("tiny pixel")).toBeVisible();
  await expect(page.getByAltText("inline icon")).toBeVisible();
  await expect(page.getByText("Remote image blocked")).toBeVisible();
  await expect(page.getByText("github.githubassets.com")).toBeVisible();
  await expect(page.getByText("image not found: does-not-exist.png")).toBeVisible();
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

  await page.keyboard.press("Meta+F");
  await page.getByPlaceholder("Find").fill("blockquote");
  await expect(page.getByText("block matches")).toBeVisible();

  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await expect(page.getByTestId("bookmarks")).toContainText("Syntax");
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

test("bookmarks track current selection and can be reordered", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path), [
    abs("test-docs/README.md"),
  ]);
  await clickToolbarBookmark(page);
  await page.evaluate(async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path), [
    abs("test-docs/syntax.md"),
  ]);
  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);

  const bookmarkRows = page.locator(".mdv-document-row[data-row-variant='bookmark']");
  await expect(bookmarkRows).toHaveCount(2);
  await expect(bookmarkRows.nth(1)).toHaveAttribute("data-selected", "true");

  await bookmarkRows.nth(1).dragTo(bookmarkRows.nth(0));
  await expect(bookmarkRows.first()).toContainText("Markdown Syntax Tour");

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("bookmark-slot-1"));
  await expect(page.getByText("syntax.md").first()).toBeVisible();
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

  await expect(page.getByTestId("history-list")).toContainText("README.md");
  await page.getByLabel("Remove README.md from history").click();
  await expect(page.getByTestId("history-list")).not.toContainText("README.md");

  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await expect(page.getByTestId("bookmarks")).toContainText("Syntax");
  await page.getByLabel("Remove bookmark Markdown Syntax Tour").click();
  await expect(page.getByTestId("bookmarks")).toContainText("No bookmarks");

  await page.getByRole("button", { name: "Search history" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("history-list")).toContainText("No history yet.");
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

  await page.getByLabel("Reveal README.md in Finder").click();
  await page.getByRole("button", { name: "Search history" }).click();
  await page.getByPlaceholder("Search history").fill("checklist");
  await page.getByLabel("Reveal README.md in Finder").click();
  await page.keyboard.press("Meta+F");
  await page.getByPlaceholder("Find").fill("blockquote");
  await clickToolbarBookmark(page);
  await ensureInspector(page);
  await ensureBookmarksExpanded(page);
  await page.getByLabel("Reveal bookmark Markdown Syntax Tour in Finder").click();

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
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("zoom-in"));

  const zoomedFontSize = await page
    .locator(".markdown-body")
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(zoomedFontSize)).toBeGreaterThan(parseFloat(initialFontSize));
  await expect(page.getByTestId("markdown-body")).toBeVisible();
});

test("native menu commands drive mdv workflows", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/toc-stress.md")],
  );

  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("toggle-sidebar"));
  await expect(page.getByRole("complementary", { name: "History" })).toHaveCount(0);
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

test("view menu toggles remote images and smart typography", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/images.md")],
  );

  await expect(page.getByText("Remote image blocked")).toBeVisible();
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("load-remote-images"));
  await expect(page.getByText("Remote image blocked")).toHaveCount(0);
  await expect(page.locator("img[src^='https://']")).toHaveCount(1);

  await page.evaluate(
    async ([path]) => window.__MDV_OPEN_DOCUMENT__?.(path),
    [abs("test-docs/prose.md")],
  );
  const smartHtml = await page.getByTestId("markdown-body").innerHTML();
  await page.evaluate(async () => window.__MDV_MENU_COMMAND__?.("smart-typography"));
  const plainHtml = await page.getByTestId("markdown-body").innerHTML();
  expect(plainHtml).not.toEqual(smartHtml);
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
      let dropHandler: ((paths: string[]) => void | Promise<void>) | undefined;
      let openHandler: ((paths: string[]) => void | Promise<void>) | undefined;
      let menuHandler: ((command: string) => void | Promise<void>) | undefined;
      const pendingDrops: string[][] = [];
      const pendingOpenRequests: string[][] = [];
      const editorCalls: Array<{ editorPath: string; documentPath: string }> = [];
      const cliInstallCalls: string[] = [];
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

      window.__MDV_TEST_API__ = {
        async openPath() {
          return Object.keys(docs)[0] ?? null;
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
          return doc;
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
          scrollPositions.set(path, {
            path,
            block_index: blockIndex,
            block_fingerprint: blockFingerprint,
            scroll_top: scrollTop,
          });
        },
        async listHistory() {
          return history;
        },
        async removeHistory(path: string) {
          const existing = history.findIndex((entry) => entry.path === path);
          if (existing >= 0) history.splice(existing, 1);
        },
        async clearHistory() {
          history.splice(0, history.length);
        },
        async searchHistory(query: string) {
          const q = query.toLowerCase();
          return history
            .filter((entry) => docs[entry.path].content.toLowerCase().includes(q))
            .map((entry) => ({
              path: entry.path,
              filename: entry.filename,
              snippet: docs[entry.path].content.slice(0, 140),
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
          return bookmarks;
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
          return bookmarks;
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
      window.__MDV_EXTERNAL_CALLS__ = externalCalls;
      window.__MDV_REVEAL_CALLS__ = revealCalls;
      window.__MDV_EDITOR_CALLS__ = editorCalls;
      window.__MDV_CLI_INSTALL_CALLS__ = cliInstallCalls;
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
  const button = page.getByRole("button", { name: "Bookmarks" });
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }
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
