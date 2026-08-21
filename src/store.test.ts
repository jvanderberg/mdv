import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchHit } from "./types";

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
