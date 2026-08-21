import { create } from "zustand";
import {
  bookmarkFingerprint,
  findBlockMatches,
  renderMarkdown,
  resolveBookmarkAnchor,
} from "./markdown";
import { api as defaultApi, type MdvApi } from "./tauri";
import type { Bookmark, HistoryEntry, LoadedDocument, SearchHit, TocHeading } from "./types";

export type Theme = "paper" | "charcoal" | "solarized";

export interface AppState {
  api: MdvApi;
  document: LoadedDocument | null;
  html: string;
  blocks: string[];
  toc: TocHeading[];
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  globalHits: SearchHit[];
  findQuery: string;
  findMatches: number[];
  currentFragment: string | null;
  pendingScrollTop: number | null;
  theme: Theme;
  zoom: number;
  inspectorVisible: boolean;
  backStack: NavigationSnapshot[];
  forwardStack: NavigationSnapshot[];
  setApi: (api: MdvApi) => void;
  refreshLists: () => Promise<void>;
  chooseAndOpenDocument: () => Promise<void>;
  chooseAndOpenDirectory: () => Promise<void>;
  openDocument: (path: string) => Promise<void>;
  openFirstPath: (paths: string[]) => Promise<void>;
  navigateToHref: (href: string) => Promise<void>;
  navigateBack: () => Promise<void>;
  navigateForward: () => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  setFindQuery: (query: string) => void;
  searchHistory: (query: string) => Promise<void>;
  saveScrollPosition: (scrollTop: number) => Promise<void>;
  consumePendingScrollTop: () => number | null;
  addBookmarkAtCurrentSpot: () => Promise<void>;
  removeHistoryEntry: (path: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeBookmark: (id: number) => Promise<void>;
  cycleTheme: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  toggleInspector: () => void;
}

interface NavigationSnapshot {
  path: string;
  fragment: string | null;
}

const themes: Theme[] = ["paper", "charcoal", "solarized"];
const documentExtensions = new Set(["md", "markdown", "mdown", "mkd", "txt"]);

export const useAppStore = create<AppState>((set, get) => ({
  api: window.__MDV_TEST_API__ ?? defaultApi,
  document: null,
  html: "",
  blocks: [],
  toc: [],
  history: [],
  bookmarks: [],
  globalHits: [],
  findQuery: "",
  findMatches: [],
  currentFragment: null,
  pendingScrollTop: null,
  theme: readTheme(),
  zoom: readStoredNumber("mdv.zoom", 1),
  inspectorVisible: localStorage.getItem("mdv.inspector") !== "false",
  backStack: [],
  forwardStack: [],

  setApi(api) {
    set({ api });
  },

  async refreshLists() {
    const { api } = get();
    const [history, bookmarks] = await Promise.all([api.listHistory(), api.listBookmarks()]);
    set({ history: [...history], bookmarks: [...bookmarks] });
  },

  async chooseAndOpenDocument() {
    const selected = await get().api.openPath();
    if (selected) await get().openDocument(selected);
  },

  async chooseAndOpenDirectory() {
    const selected = await get().api.openDirectory();
    if (selected) await get().openDocument(selected);
  },

  async openDocument(path) {
    const loaded = await get().api.loadMarkdown(path);
    const rendered = renderMarkdown(loaded.content);
    const findMatches = findBlockMatches(rendered.blocks, get().findQuery);
    const scrollPosition = await get().api.loadScrollPosition(loaded.path);
    set({
      document: loaded,
      html: rendered.html,
      blocks: rendered.blocks,
      toc: rendered.toc,
      findMatches,
      currentFragment: null,
      pendingScrollTop: scrollPosition?.scroll_top ?? 0,
      globalHits: [],
    });
    await get().refreshLists();
  },

  async openFirstPath(paths) {
    const path = paths[0];
    if (path) await get().openDocument(path);
  },

  async navigateToHref(href) {
    const current = get().document;
    if (!current) return;
    const target = resolveLinkTarget(current.path, href);
    const currentSnapshot = snapshotFor(current.path, get().currentFragment);
    if (target.kind === "fragment") {
      set((state) => ({
        backStack: [...state.backStack, currentSnapshot],
        currentFragment: target.fragment,
        forwardStack: [],
      }));
      scrollToFragment(target.fragment);
      return;
    }
    if (target.kind === "document") {
      set((state) => ({
        backStack: [...state.backStack, currentSnapshot],
        forwardStack: [],
      }));
      await get().openDocument(target.path);
      const { fragment } = target;
      set({ currentFragment: fragment });
      if (fragment) queueMicrotask(() => scrollToFragment(fragment));
      return;
    }
    await get().api.openExternalTarget(target.href);
  },

  async navigateBack() {
    const current = get().document;
    const previous = get().backStack.at(-1);
    if (!current || !previous) return;
    const currentSnapshot = snapshotFor(current.path, get().currentFragment);
    set((state) => ({
      backStack: state.backStack.slice(0, -1),
      forwardStack: [...state.forwardStack, currentSnapshot],
    }));
    await get().openDocument(previous.path);
    const { fragment } = previous;
    set({ currentFragment: fragment });
    if (fragment) queueMicrotask(() => scrollToFragment(fragment));
  },

  async navigateForward() {
    const current = get().document;
    const next = get().forwardStack.at(-1);
    if (!current || !next) return;
    const currentSnapshot = snapshotFor(current.path, get().currentFragment);
    set((state) => ({
      backStack: [...state.backStack, currentSnapshot],
      forwardStack: state.forwardStack.slice(0, -1),
    }));
    await get().openDocument(next.path);
    const { fragment } = next;
    set({ currentFragment: fragment });
    if (fragment) queueMicrotask(() => scrollToFragment(fragment));
  },

  async revealPath(path) {
    await get().api.revealPath(path);
  },

  setFindQuery(query) {
    set({
      findQuery: query,
      findMatches: findBlockMatches(get().blocks, query),
    });
  },

  async searchHistory(query) {
    if (!query.trim()) {
      set({ globalHits: [] });
      return;
    }
    set({ globalHits: await get().api.searchHistory(query) });
  },

  async saveScrollPosition(scrollTop) {
    const { api, blocks, document } = get();
    if (!document || blocks.length === 0) return;
    const blockIndex = Math.max(0, Math.min(blocks.length - 1, Math.floor(scrollTop / 220)));
    await api.saveScrollPosition({
      path: document.path,
      blockIndex,
      blockFingerprint: bookmarkFingerprint(blocks[blockIndex] ?? ""),
      scrollTop: Math.max(0, Math.round(scrollTop)),
    });
  },

  consumePendingScrollTop() {
    const scrollTop = get().pendingScrollTop;
    set({ pendingScrollTop: null });
    return scrollTop;
  },

  async addBookmarkAtCurrentSpot() {
    const { api, blocks, document, findMatches, toc } = get();
    if (!document) return;
    const blockIndex = findMatches[0] ?? 0;
    await api.addBookmark({
      path: document.path,
      title: toc[0]?.text ?? document.filename,
      blockIndex,
      blockFingerprint: bookmarkFingerprint(blocks[blockIndex] ?? ""),
    });
    await get().refreshLists();
  },

  async removeHistoryEntry(path) {
    await get().api.removeHistory(path);
    set((state) => ({
      history: state.history.filter((entry) => entry.path !== path),
      globalHits: state.globalHits.filter((hit) => hit.path !== path),
    }));
  },

  async clearHistory() {
    await get().api.clearHistory();
    set({ history: [], globalHits: [] });
  },

  async removeBookmark(id) {
    await get().api.removeBookmark(id);
    set((state) => ({
      bookmarks: state.bookmarks
        .filter((bookmark) => bookmark.id !== id)
        .map((bookmark, index) => ({ ...bookmark, sort_order: index })),
    }));
    await get().refreshLists();
  },

  cycleTheme() {
    const next = themes[(themes.indexOf(get().theme) + 1) % themes.length];
    localStorage.setItem("mdv.theme", next);
    set({ theme: next });
  },

  zoomIn() {
    const zoom = Math.min(1.6, Math.round((get().zoom + 0.1) * 10) / 10);
    localStorage.setItem("mdv.zoom", String(zoom));
    set({ zoom });
  },

  zoomOut() {
    const zoom = Math.max(0.8, Math.round((get().zoom - 0.1) * 10) / 10);
    localStorage.setItem("mdv.zoom", String(zoom));
    set({ zoom });
  },

  toggleInspector() {
    const inspectorVisible = !get().inspectorVisible;
    localStorage.setItem("mdv.inspector", String(inspectorVisible));
    set({ inspectorVisible });
  },
}));

export function resolveBookmarkForTest(
  blocks: string[],
  index: number,
  fingerprint: string,
): number {
  return resolveBookmarkAnchor(blocks, index, fingerprint);
}

function readTheme(): Theme {
  const stored = localStorage.getItem("mdv.theme");
  return themes.includes(stored as Theme) ? (stored as Theme) : "paper";
}

export function readStoredNumber(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? value : fallback;
}

type LinkTarget =
  | { kind: "document"; path: string; fragment: string | null }
  | { kind: "external"; href: string }
  | { kind: "fragment"; fragment: string };

function resolveLinkTarget(currentPath: string, href: string): LinkTarget {
  const [rawPath = "", rawFragment] = href.split("#", 2);
  const fragment = rawFragment ? decodeURIComponent(rawFragment) : null;
  if (!rawPath && fragment) return { kind: "fragment", fragment };

  if (hasExternalScheme(rawPath) && !rawPath.startsWith("file://")) {
    return { kind: "external", href };
  }

  const path = normalizePath(
    rawPath.startsWith("file://")
      ? new URL(rawPath).pathname
      : joinPath(dirname(currentPath), rawPath),
  );
  if (!documentExtensions.has(extension(path))) return { kind: "external", href };
  return { kind: "document", path, fragment };
}

function snapshotFor(path: string, fragment: string | null): NavigationSnapshot {
  return { path, fragment };
}

function scrollToFragment(fragment: string) {
  const id = CSS.escape(fragment);
  document.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: "start" });
}

function hasExternalScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function dirname(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/"))) || "/";
}

function joinPath(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  return `${base}/${decodeURIComponent(path)}`;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function extension(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}
