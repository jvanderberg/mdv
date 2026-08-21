import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});

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
