import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const out = process.env.MDV_TAURI_CAPTURE ?? `${root}parity-artifacts/tauri/tauri-window.png`;
const doc = process.env.MDV_CAPTURE_DOC ?? `${root}test-docs/README.md`;
const url = process.env.MDV_TAURI_URL ?? "http://127.0.0.1:1420/";

const server = spawn("npm", ["run", "dev"], {
  cwd: root,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(url);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 1080, height: 668 },
  });

  await page.route("**/__mdv_fixture**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const fixturePath = requestUrl.searchParams.get("path");
    if (!fixturePath) throw new Error("missing fixture path");
    await route.fulfill({
      body: await readFile(fixturePath, "utf8"),
      contentType: "text/markdown",
    });
  });

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("mdv.inspector", "true");
    localStorage.setItem("mdv.sidebar", "true");
    const history = [];
    const scrollPositions = new Map();
    window.__MDV_TEST_API__ = {
      async openPath() {
        return null;
      },
      async openDirectory() {
        return null;
      },
      async chooseEditor() {
        return null;
      },
      async openInEditor() {},
      async installCli() {
        return "installed";
      },
      async loadMarkdown(path) {
        const filename = path.split("/").pop() || path;
        const content = await fetch(`/__mdv_fixture?path=${encodeURIComponent(path)}`).then((r) =>
          r.text(),
        );
        history.unshift({ path, filename, added_at: Date.now() });
        return { path, filename, content, siblings: [] };
      },
      async resolveLocalImage(documentPath, src) {
        const path = src.startsWith("/")
          ? src
          : `${documentPath.slice(0, documentPath.lastIndexOf("/"))}/${decodeURIComponent(src)}`;
        return { path, exists: true };
      },
      localImageUrl(path) {
        return `/__mdv_fixture?path=${encodeURIComponent(path)}`;
      },
      async loadScrollPosition(path) {
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
      async removeHistory(path) {
        const existing = history.findIndex((entry) => entry.path === path);
        if (existing >= 0) history.splice(existing, 1);
      },
      async clearHistory() {
        history.splice(0, history.length);
      },
      async searchHistory() {
        return [];
      },
      async addBookmark() {
        throw new Error("not used");
      },
      async listBookmarks() {
        return [];
      },
      async removeBookmark() {},
      async revealPath() {},
      async openExternalTarget() {},
      async subscribeToFileDrops() {
        return () => {};
      },
      async subscribeToOpenRequests() {
        return () => {};
      },
      async subscribeToMenuCommands() {
        return () => {};
      },
      async takePendingOpenPaths() {
        return [];
      },
    };
  });

  await page.goto(url);
  await page.evaluate((path) => window.__MDV_OPEN_DOCUMENT__?.(path), doc);
  await page.getByTestId("toc").waitFor({ state: "visible" });
  await page.screenshot({ fullPage: false, path: out });
  await browser.close();
  console.log(`captured Tauri window: ${out}`);
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(target) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // Keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${target}`);
}
