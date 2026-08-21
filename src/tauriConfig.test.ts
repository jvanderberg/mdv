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

describe("tauri bundle configuration", () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as TauriConfig;

  it("keeps mdv app identity and bundle assets", () => {
    expect(config.productName).toBe("mdv");
    expect(config.identifier).toBe("com.jvanderberg.mdv");
    expect(config.bundle.icon).toEqual(["icons/MDV.png"]);
    expect(config.bundle.resources).toEqual(["resources/Help.md"]);
  });

  it("enables Tauri's production asset protocol for Cargo installations", () => {
    const manifest = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

    expect(manifest).toContain('default = ["custom-protocol"]');
    expect(manifest).toContain('custom-protocol = ["tauri/custom-protocol"]');
  });

  it("registers mdv document associations", () => {
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

  it("keeps the mdv menu command surface wired in Tauri", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    const expectedItems = [
      ["open", "Open…", "CmdOrCtrl+O"],
      ["open-new-window", "Open in New Window…", "CmdOrCtrl+Shift+O"],
      ["edit-current-file", "Edit Current File", "CmdOrCtrl+E"],
      ["choose-editor", "Choose Editor…", null],
      ["forget-editor", "Forget Editor", null],
      ["find", "Find…", "CmdOrCtrl+F"],
      ["search-history", "Search History…", "CmdOrCtrl+Shift+F"],
      ["back", "Back", "CmdOrCtrl+ArrowLeft"],
      ["forward", "Forward", "CmdOrCtrl+ArrowRight"],
      ["toggle-sidebar", "Hide Sidebar", "CmdOrCtrl+Shift+S"],
      ["zoom-in", "Zoom In", "CmdOrCtrl+="],
      ["zoom-out", "Zoom Out", "CmdOrCtrl+-"],
      ["actual-size", "Actual Size", null],
      ["smart-typography", "Smart Typography", null],
      ["load-remote-images", "Load Remote Images", null],
      ["bookmark-current-spot", "Bookmark Current Spot", "CmdOrCtrl+D"],
      ["set-placeholder", "Set Placeholder", "CmdOrCtrl+Shift+0"],
      ["jump-to-placeholder", "Jump to Placeholder", "CmdOrCtrl+0"],
      ["bookmark-slot-1", "Slot 1 — Empty", "CmdOrCtrl+1"],
      ["bookmark-slot-2", "Slot 2 — Empty", "CmdOrCtrl+2"],
      ["bookmark-slot-3", "Slot 3 — Empty", "CmdOrCtrl+3"],
      ["bookmark-slot-4", "Slot 4 — Empty", "CmdOrCtrl+4"],
      ["bookmark-slot-5", "Slot 5 — Empty", "CmdOrCtrl+5"],
      ["help", "mdv Help", "CmdOrCtrl+?"],
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
    expect(rustSource).toContain("CheckMenuItem::with_id");
    expect(rustSource).toMatch(
      /CheckMenuItem::with_id\(\s*app,\s*"smart-typography",\s*"Smart Typography",\s*true,\s*true,/s,
    );
    expect(rustSource).toMatch(
      /CheckMenuItem::with_id\(\s*app,\s*"load-remote-images",\s*"Load Remote Images",\s*true,\s*false,/s,
    );
  });

  it("keeps upstream shared-state and SQLite concurrency contracts", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const tauriSource = readFileSync(resolve(process.cwd(), "src/tauri.ts"), "utf8");
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(rustSource).toContain("SQLITE_OPEN_FULL_MUTEX");
    expect(rustSource).toContain('app.emit("mdv://shared-state-changed"');
    expect(tauriSource).toContain('listen<string>("mdv://shared-state-changed"');
    expect(appSource).toContain("subscribeToSharedStateChanges");
    expect(appSource).toContain("refreshLists");
  });
});
