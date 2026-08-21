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

  it("keeps a signed and notarized DMG release workflow", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/tauri-release.yml"),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["tauri:dmg"]).toBe("tauri build --bundles dmg");
    expect(workflow).toContain("tauri-apps/tauri-action@v1");
    expect(workflow).toContain("aarch64-apple-darwin");
    expect(workflow).toContain("x86_64-apple-darwin");
    expect(workflow).toContain("--bundles dmg");
    expect(workflow).toContain("APPLE_CERTIFICATE");
    expect(workflow).toContain("APPLE_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("APPLE_API_KEY_PATH");
    expect(workflow).toContain("APPLE_API_ISSUER");
    expect(workflow).toContain("KEYCHAIN_PASSWORD");
    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toContain("uploadWorkflowArtifacts: true");
  });
});
