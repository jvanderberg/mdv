import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface TauriConfig {
  productName: string;
  identifier: string;
  bundle: {
    resources: string[];
    icon: string[];
    fileAssociations: Array<{
      ext: string[];
      name: string;
      description: string;
      role: string;
    }>;
  };
}

interface TauriCapability {
  windows: string[];
}

describe("tauri bundle parity contract", () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as TauriConfig;

  it("keeps mdv app identity and bundle assets", () => {
    expect(config.productName).toBe("mdv");
    expect(config.identifier).toBe("com.jvanderberg.mdv");
    expect(config.bundle.icon).toEqual(["../MDV.png", "../mdv/AppIcon.icns"]);
    expect(config.bundle.resources).toEqual(["../bin/mdv", "../mdv/Help.md"]);
  });

  it("registers Swift mdv document associations", () => {
    expect(config.bundle.fileAssociations).toEqual([
      {
        ext: ["md", "markdown", "mdown", "mkd", "txt"],
        name: "Markdown",
        description: "Markdown or plain text document",
        role: "Viewer",
      },
    ]);
  });

  it("allows commands from every mdv document window", () => {
    const capability = JSON.parse(
      readFileSync(resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf8"),
    ) as TauriCapability;

    expect(capability.windows).toEqual(["*"]);
  });
});
