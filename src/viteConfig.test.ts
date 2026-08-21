import { describe, expect, it } from "vitest";
import { webkitBuildTarget } from "../vite.config";

describe("production browser compatibility", () => {
  it("targets the WebKit version shipped with supported macOS releases", () => {
    expect(webkitBuildTarget).toBe("safari13");
  });
});
