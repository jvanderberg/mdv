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

  it("keeps the Swift mdv custom menu command surface wired in Tauri", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    const expectedItems = [
      ["install-cli", "Install Command Line Tool…", null],
      ["open", "Open…", "Cmd+O"],
      ["open-new-window", "Open in New Window…", "Cmd+Shift+O"],
      ["edit-current-file", "Edit Current File", "Cmd+E"],
      ["choose-editor", "Choose Editor…", null],
      ["forget-editor", "Forget Editor", null],
      ["find", "Find…", "Cmd+F"],
      ["search-history", "Search History…", "Cmd+Shift+F"],
      ["back", "Back", "Cmd+ArrowLeft"],
      ["forward", "Forward", "Cmd+ArrowRight"],
      ["toggle-sidebar", "Hide Sidebar", "Cmd+Ctrl+S"],
      ["zoom-in", "Zoom In", "Cmd+="],
      ["zoom-out", "Zoom Out", "Cmd+-"],
      ["actual-size", "Actual Size", null],
      ["smart-typography", "Smart Typography", null],
      ["load-remote-images", "Load Remote Images", null],
      ["bookmark-current-spot", "Bookmark Current Spot", "Cmd+D"],
      ["set-placeholder", "Set Placeholder", "Cmd+Shift+0"],
      ["jump-to-placeholder", "Jump to Placeholder", "Cmd+0"],
      ["bookmark-slot-1", "Slot 1 — Empty", "Cmd+1"],
      ["bookmark-slot-2", "Slot 2 — Empty", "Cmd+2"],
      ["bookmark-slot-3", "Slot 3 — Empty", "Cmd+3"],
      ["bookmark-slot-4", "Slot 4 — Empty", "Cmd+4"],
      ["bookmark-slot-5", "Slot 5 — Empty", "Cmd+5"],
      ["help", "mdv Help", "Cmd+?"],
    ] as const;

    for (const [id, label, shortcut] of expectedItems) {
      expect(rustSource).toContain(`"${id}"`);
      expect(rustSource).toContain(`"${label}"`);
      if (shortcut) expect(rustSource).toContain(`"${shortcut}"`);
      if (id.startsWith("bookmark-slot-")) {
        expect(appSource).toContain('command.startsWith("bookmark-slot-")');
        expect(appSource).toContain("openBookmarkSlot");
      } else if (id !== "help") {
        expect(appSource).toContain(`case "${id}"`);
      }
    }

    expect(rustSource).not.toContain("Open...");
    expect(rustSource).not.toContain("Choose Editor...");
    expect(rustSource).not.toContain("Slot 1 - Empty");
  });
});
