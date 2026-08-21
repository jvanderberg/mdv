import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath as openSystemPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  Bookmark,
  FileSignature,
  HistoryEntry,
  LoadedDocument,
  NativeMenuState,
  ResolvedLocalImage,
  ScrollPosition,
  SearchHit,
} from "./types";

export interface MdvApi {
  openPath(): Promise<string | null>;
  openPathInNewWindow(path: string): Promise<void>;
  openDirectory(): Promise<string | null>;
  chooseEditor(): Promise<string | null>;
  openInEditor(editorPath: string, documentPath: string): Promise<void>;
  installCli(): Promise<string>;
  subscribeToFileDrops(onDrop: (paths: string[]) => void | Promise<void>): Promise<() => void>;
  subscribeToOpenRequests(onOpen: (paths: string[]) => void | Promise<void>): Promise<() => void>;
  subscribeToMenuCommands(
    onCommand: (command: string) => void | Promise<void>,
  ): Promise<() => void>;
  subscribeToSharedStateChanges(onChange: () => void | Promise<void>): Promise<() => void>;
  takePendingOpenPaths(): Promise<string[]>;
  openExternalTarget(target: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  loadMarkdown(path: string): Promise<LoadedDocument>;
  fileSignature(path: string): Promise<FileSignature>;
  resolveLocalImage(documentPath: string, src: string): Promise<ResolvedLocalImage>;
  localImageUrl(path: string): string;
  loadScrollPosition(path: string): Promise<ScrollPosition | null>;
  saveScrollPosition(args: {
    path: string;
    blockIndex: number;
    blockFingerprint: string;
    scrollTop: number;
  }): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  removeHistory(path: string): Promise<void>;
  clearHistory(): Promise<void>;
  searchHistory(query: string): Promise<SearchHit[]>;
  addBookmark(args: {
    path: string;
    title: string;
    blockIndex: number;
    blockFingerprint: string;
  }): Promise<Bookmark>;
  listBookmarks(): Promise<Bookmark[]>;
  removeBookmark(id: number): Promise<void>;
  reorderBookmarks(ids: number[]): Promise<Bookmark[]>;
  instrumentationCapturePath?: () => Promise<string | null>;
  captureTauriWindow?: (outputPath: string) => Promise<void>;
  updateNativeMenuState?: (state: NativeMenuState) => Promise<void>;
}

export const api: MdvApi = {
  async openPath() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  openPathInNewWindow(path) {
    return tauriInvoke("open_new_window", { path });
  },
  async openDirectory() {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    return typeof selected === "string" ? selected : null;
  },
  async chooseEditor() {
    const selected = await open({
      directory: false,
      multiple: false,
      defaultPath: "/Applications",
      filters: [{ name: "Applications", extensions: ["app"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  openInEditor(editorPath, documentPath) {
    return tauriInvoke("open_in_editor", { editorPath, documentPath });
  },
  installCli() {
    return tauriInvoke("install_cli");
  },
  async subscribeToFileDrops(onDrop) {
    return getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") await onDrop(event.payload.paths);
    });
  },
  async subscribeToOpenRequests(onOpen) {
    return listen<string[]>("mdv://open-paths", async (event) => {
      await onOpen(event.payload);
    });
  },
  async subscribeToMenuCommands(onCommand) {
    return listen<string>("mdv://menu-command", async (event) => {
      await onCommand(event.payload);
    });
  },
  async subscribeToSharedStateChanges(onChange) {
    return listen<string>("mdv://shared-state-changed", async () => {
      await onChange();
    });
  },
  takePendingOpenPaths() {
    return tauriInvoke("take_pending_open_paths");
  },
  openExternalTarget(target) {
    if (target.startsWith("/") || target.startsWith("file://")) {
      return openSystemPath(target.startsWith("file://") ? new URL(target).pathname : target);
    }
    return openUrl(target);
  },
  revealPath(path) {
    return revealItemInDir(path);
  },
  loadMarkdown(path) {
    return tauriInvoke("load_markdown", { path });
  },
  fileSignature(path) {
    return tauriInvoke("file_signature", { path });
  },
  resolveLocalImage(documentPath, src) {
    return tauriInvoke("resolve_local_image", { documentPath, src });
  },
  localImageUrl(path) {
    return convertFileSrc(path);
  },
  loadScrollPosition(path) {
    return tauriInvoke("load_scroll_position", { path });
  },
  saveScrollPosition({ path, blockIndex, blockFingerprint, scrollTop }) {
    return tauriInvoke("save_scroll_position", {
      path,
      blockIndex,
      blockFingerprint,
      scrollTop,
    });
  },
  listHistory() {
    return tauriInvoke("list_history");
  },
  removeHistory(path) {
    return tauriInvoke("remove_history", { path });
  },
  clearHistory() {
    return tauriInvoke("clear_history");
  },
  searchHistory(query) {
    return tauriInvoke("search_history", { query });
  },
  addBookmark({ path, title, blockIndex, blockFingerprint }) {
    return tauriInvoke("add_bookmark", {
      path,
      title,
      blockIndex,
      blockFingerprint,
    });
  },
  listBookmarks() {
    return tauriInvoke("list_bookmarks");
  },
  removeBookmark(id) {
    return tauriInvoke("remove_bookmark", { id });
  },
  reorderBookmarks(ids) {
    return tauriInvoke("reorder_bookmarks", { ids });
  },
  instrumentationCapturePath() {
    return tauriInvoke("instrumentation_capture_path");
  },
  captureTauriWindow(outputPath) {
    return tauriInvoke("capture_tauri_window", { outputPath });
  },
  updateNativeMenuState(state) {
    return tauriInvoke("update_menu_state", { state });
  },
};
