import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Bookmark, SearchHit } from "./types";

describe("store persistence helpers", () => {
  beforeEach(() => {
    installStorage();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("uses the fallback for missing numeric values", async () => {
    const { readStoredNumber } = await import("./store");
    expect(readStoredNumber("mdv.zoom", 1)).toBe(1);
  });

  it("uses stored finite numeric values", async () => {
    const { readStoredNumber } = await import("./store");
    localStorage.setItem("mdv.zoom", "1.2");
    expect(readStoredNumber("mdv.zoom", 1)).toBe(1.2);
  });

  it("resolves stored Swift theme aliases and invalid values", async () => {
    const { readTheme } = await import("./store");

    localStorage.setItem("mdv.theme", "paper");
    expect(readTheme()).toBe("high-contrast");

    localStorage.setItem("mdv.theme", "solarized");
    expect(readTheme()).toBe("solarium-daylight");

    localStorage.setItem("mdv.theme", "standard-erin-dark");
    expect(readTheme()).toBe("standard-erin-dark");

    localStorage.setItem("mdv.theme", "bogus");
    expect(readTheme()).toBe("high-contrast");
  });

  it("matches Swift smart typography theme opt-outs", async () => {
    const { smartTypographyAllowed } = await import("./store");

    expect(smartTypographyAllowed("high-contrast")).toBe(true);
    expect(smartTypographyAllowed("sevilla")).toBe(true);
    expect(smartTypographyAllowed("phosphor")).toBe(false);
    expect(smartTypographyAllowed("standard-erin-light")).toBe(false);
    expect(smartTypographyAllowed("standard-erin-dark")).toBe(false);
  });

  it("opens selected documents in a new native window without replacing state", async () => {
    const { useAppStore } = await import("./store");
    const opened: string[] = [];
    useAppStore.setState({
      document: {
        path: "/current.md",
        filename: "current.md",
        content: "# Current",
        file_mtime_ms: 1,
        file_size: 9,
      },
      api: {
        ...useAppStore.getState().api,
        async openPath() {
          return "/next.md";
        },
        async openPathInNewWindow(path: string) {
          opened.push(path);
        },
      },
    });

    await useAppStore.getState().chooseAndOpenDocumentInNewWindow();

    expect(opened).toEqual(["/next.md"]);
    expect(useAppStore.getState().document?.path).toBe("/current.md");
  });

  it("ignores stale global search results", async () => {
    const { useAppStore } = await import("./store");
    const slow = deferred<SearchHit[]>();
    const fast = deferred<SearchHit[]>();
    useAppStore.setState({
      globalHits: [],
      api: {
        ...useAppStore.getState().api,
        searchHistory(query: string) {
          return query === "slow" ? slow.promise : fast.promise;
        },
      },
    });

    const slowSearch = useAppStore.getState().searchHistory("slow");
    const fastSearch = useAppStore.getState().searchHistory("fast");
    fast.resolve([{ path: "/fast.md", filename: "fast.md", snippet: "\u0002fast\u0003" }]);
    await fastSearch;
    slow.resolve([{ path: "/slow.md", filename: "slow.md", snippet: "\u0002slow\u0003" }]);
    await slowSearch;

    expect(useAppStore.getState().globalHits).toEqual([
      { path: "/fast.md", filename: "fast.md", snippet: "\u0002fast\u0003" },
    ]);
  });

  it("resolves bookmark jumps by fingerprint after document edits", async () => {
    const { bookmarkFingerprint, splitBlocks } = await import("./markdown");
    const { useAppStore } = await import("./store");
    const originalBlocks = splitBlocks("# Title\n\nAnchor paragraph.\n\nTail.");
    const bookmark: Bookmark = {
      id: 7,
      path: "/doc.md",
      title: "Anchor",
      sort_order: 0,
      created_at: 1,
      block_index: 1,
      block_fingerprint: bookmarkFingerprint(originalBlocks[1]),
      file_exists: true,
    };
    useAppStore.setState({
      bookmarks: [bookmark],
      api: {
        ...useAppStore.getState().api,
        async loadMarkdown() {
          return {
            path: "/doc.md",
            filename: "doc.md",
            content: "# Title\n\nInserted paragraph.\n\nAnchor paragraph.\n\nTail.",
            file_mtime_ms: 1,
            file_size: 58,
          };
        },
        async loadScrollPosition() {
          return null;
        },
        async listHistory() {
          return [];
        },
        async listBookmarks() {
          return [bookmark];
        },
      },
    });

    await useAppStore.getState().openBookmark(7);

    expect(useAppStore.getState().pendingBlockIndex).toBe(2);
    expect(useAppStore.getState().activeBookmarkId).toBe(7);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
}
