import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath as openSystemPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  Bookmark,
  HistoryEntry,
  LoadedDocument,
  ResolvedLocalImage,
  ScrollPosition,
  SearchHit,
} from "./types";

export interface MdvApi {
  openPath(): Promise<string | null>;
  openDirectory(): Promise<string | null>;
  subscribeToFileDrops(onDrop: (paths: string[]) => void | Promise<void>): Promise<() => void>;
  subscribeToOpenRequests(onOpen: (paths: string[]) => void | Promise<void>): Promise<() => void>;
  takePendingOpenPaths(): Promise<string[]>;
  openExternalTarget(target: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  loadMarkdown(path: string): Promise<LoadedDocument>;
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
}

export const api: MdvApi = {
  async openPath() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  async openDirectory() {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    return typeof selected === "string" ? selected : null;
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
};
