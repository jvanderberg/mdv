import { create } from "zustand";
import {
  bookmarkFingerprint,
  findBlockMatches,
  renderMarkdown,
  resolveBookmarkAnchor,
} from "./markdown";
import { api as defaultApi, type MdvApi } from "./tauri";
import type { Bookmark, HistoryEntry, LoadedDocument, SearchHit, TocHeading } from "./types";

export const themes = [
  "system",
  "high-contrast",
  "sevilla",
  "charcoal",
  "solarium-daylight",
  "solarium-moonlight",
  "phosphor",
  "twilight",
  "standard-erin-light",
  "standard-erin-dark",
] as const;

export type Theme = (typeof themes)[number];

export interface AppState {
  api: MdvApi;
  document: LoadedDocument | null;
  html: string;
  blocks: string[];
  toc: TocHeading[];
  activeTocHeadingId: string | null;
  activeBookmarkId: number | null;
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  globalHits: SearchHit[];
  findQuery: string;
  findMatches: number[];
  currentFindMatchIndex: number;
  currentFragment: string | null;
  pendingScrollTop: number | null;
  pendingBlockIndex: number | null;
  theme: Theme;
  zoom: number;
  inspectorVisible: boolean;
  sidebarVisible: boolean;
  editorAppPath: string;
  loadRemoteImages: boolean;
  smartTypography: boolean;
  viewerScrollTop: number;
  activeBlockIndex: number;
  placeholder: NavigationSnapshot | null;
  backStack: NavigationSnapshot[];
  forwardStack: NavigationSnapshot[];
  setApi: (api: MdvApi) => void;
  refreshLists: () => Promise<void>;
  chooseAndOpenDocument: () => Promise<void>;
  chooseAndOpenDocumentInNewWindow: () => Promise<void>;
  chooseAndOpenDirectory: () => Promise<void>;
  chooseEditor: () => Promise<void>;
  editCurrentFile: () => Promise<void>;
  forgetEditor: () => void;
  openDocument: (path: string) => Promise<void>;
  reloadCurrentDocumentFromDisk: () => Promise<void>;
  openFirstPath: (paths: string[]) => Promise<void>;
  navigateToHref: (href: string) => Promise<void>;
  navigateBack: () => Promise<void>;
  navigateForward: () => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  setFindQuery: (query: string) => void;
  nextFindMatch: () => void;
  previousFindMatch: () => void;
  searchHistory: (query: string) => Promise<void>;
  saveScrollPosition: (scrollTop: number) => Promise<void>;
  setViewerScrollTop: (scrollTop: number) => void;
  setActiveBlockIndex: (blockIndex: number) => void;
  setActiveTocHeadingId: (id: string | null) => void;
  consumePendingScrollTop: () => number | null;
  consumePendingBlockIndex: () => number | null;
  addBookmarkAtCurrentSpot: () => Promise<void>;
  openBookmark: (id: number) => Promise<void>;
  openBookmarkSlot: (slot: number) => Promise<void>;
  reorderBookmarks: (ids: number[]) => Promise<void>;
  setPlaceholder: () => void;
  jumpToPlaceholder: () => Promise<void>;
  clearPlaceholder: () => void;
  removeHistoryEntry: (path: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeBookmark: (id: number) => Promise<void>;
  cycleTheme: () => void;
  setTheme: (theme: Theme) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleInspector: () => void;
  toggleSidebar: () => void;
  toggleLoadRemoteImages: () => void;
  toggleSmartTypography: () => void;
}

interface NavigationSnapshot {
  path: string;
  fragment: string | null;
  blockIndex: number;
  blockFingerprint?: string;
  title?: string;
  scrollTop?: number;
}

const documentExtensions = new Set(["md", "markdown", "mdown", "mkd", "txt"]);
let searchHistoryRequestToken = 0;

export const useAppStore = create<AppState>((set, get) => ({
  api: window.__MDV_TEST_API__ ?? defaultApi,
  document: null,
  html: "",
  blocks: [],
  toc: [],
  activeTocHeadingId: null,
  activeBookmarkId: null,
  history: [],
  bookmarks: [],
  globalHits: [],
  findQuery: "",
  findMatches: [],
  currentFindMatchIndex: 0,
  currentFragment: null,
  pendingScrollTop: null,
  pendingBlockIndex: null,
  theme: readTheme(),
  zoom: readStoredNumber("mdv.zoom", 1),
  inspectorVisible: localStorage.getItem("mdv.inspector") !== "false",
  sidebarVisible: localStorage.getItem("mdv.sidebar") !== "false",
  editorAppPath: localStorage.getItem("mdv.editorAppPath") ?? "",
  loadRemoteImages: localStorage.getItem("mdv.loadRemoteImages") === "true",
  smartTypography: localStorage.getItem("mdv.smartTypography") !== "false",
  viewerScrollTop: 0,
  activeBlockIndex: 0,
  placeholder: null,
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

  async chooseAndOpenDocumentInNewWindow() {
    const selected = await get().api.openPath();
    if (selected) await get().api.openPathInNewWindow(selected);
  },

  async chooseAndOpenDirectory() {
    const selected = await get().api.openDirectory();
    if (selected) await get().openDocument(selected);
  },

  async chooseEditor() {
    const selected = await get().api.chooseEditor();
    if (!selected) return;
    localStorage.setItem("mdv.editorAppPath", selected);
    set({ editorAppPath: selected });
    if (get().document) await get().editCurrentFile();
  },

  async editCurrentFile() {
    const { api, document } = get();
    if (!document) return;
    let { editorAppPath } = get();
    if (!editorAppPath) {
      const selected = await api.chooseEditor();
      if (!selected) return;
      editorAppPath = selected;
      localStorage.setItem("mdv.editorAppPath", editorAppPath);
      set({ editorAppPath });
    }
    await api.openInEditor(editorAppPath, document.path);
  },

  forgetEditor() {
    localStorage.removeItem("mdv.editorAppPath");
    set({ editorAppPath: "" });
  },

  async openDocument(path) {
    const loaded = await get().api.loadMarkdown(path);
    const rendered = renderMarkdown(loaded.content, {
      loadRemoteImages: get().loadRemoteImages,
      typographer: get().smartTypography && smartTypographyAllowed(get().theme),
    });
    const findMatches = findBlockMatches(rendered.blocks, get().findQuery);
    const scrollPosition = await get().api.loadScrollPosition(loaded.path);
    set({
      document: loaded,
      html: rendered.html,
      blocks: rendered.blocks,
      toc: rendered.toc,
      activeTocHeadingId: rendered.toc[0]?.id ?? null,
      findMatches,
      currentFindMatchIndex: 0,
      currentFragment: null,
      pendingScrollTop: scrollPosition?.scroll_top ?? 0,
      pendingBlockIndex: scrollPosition?.block_index ?? null,
      globalHits: [],
      activeBookmarkId: null,
      activeBlockIndex: scrollPosition?.block_index ?? 0,
    });
    await get().refreshLists();
  },

  async reloadCurrentDocumentFromDisk() {
    const current = get().document;
    if (!current) return;
    const loaded = await get().api.loadMarkdown(current.path);
    const rendered = renderMarkdown(loaded.content, {
      loadRemoteImages: get().loadRemoteImages,
      typographer: get().smartTypography && smartTypographyAllowed(get().theme),
    });
    const findMatches = findBlockMatches(rendered.blocks, get().findQuery);
    set({
      document: loaded,
      html: rendered.html,
      blocks: rendered.blocks,
      toc: rendered.toc,
      activeTocHeadingId: rendered.toc[0]?.id ?? null,
      findMatches,
      currentFindMatchIndex: Math.min(
        get().currentFindMatchIndex,
        Math.max(0, findMatches.length - 1),
      ),
      pendingScrollTop: get().viewerScrollTop,
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
    const currentSnapshot = snapshotFor(
      current.path,
      get().currentFragment,
      get().activeBlockIndex,
    );
    if (target.kind === "fragment") {
      set((state) => ({
        backStack: [...state.backStack, currentSnapshot],
        currentFragment: target.fragment,
        forwardStack: [],
      }));
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
      return;
    }
    await get().api.openExternalTarget(target.href);
  },

  async navigateBack() {
    const current = get().document;
    const previous = get().backStack.at(-1);
    if (!current || !previous) return;
    const currentSnapshot = snapshotFor(
      current.path,
      get().currentFragment,
      get().activeBlockIndex,
    );
    set((state) => ({
      backStack: state.backStack.slice(0, -1),
      forwardStack: [...state.forwardStack, currentSnapshot],
    }));
    await get().openDocument(previous.path);
    const { fragment } = previous;
    set({
      currentFragment: fragment,
      pendingBlockIndex: fragment ? null : previous.blockIndex,
    });
  },

  async navigateForward() {
    const current = get().document;
    const next = get().forwardStack.at(-1);
    if (!current || !next) return;
    const currentSnapshot = snapshotFor(
      current.path,
      get().currentFragment,
      get().activeBlockIndex,
    );
    set((state) => ({
      backStack: [...state.backStack, currentSnapshot],
      forwardStack: state.forwardStack.slice(0, -1),
    }));
    await get().openDocument(next.path);
    const { fragment } = next;
    set({
      currentFragment: fragment,
      pendingBlockIndex: fragment ? null : next.blockIndex,
    });
  },

  async revealPath(path) {
    await get().api.revealPath(path);
  },

  setFindQuery(query) {
    set({
      findQuery: query,
      findMatches: findBlockMatches(get().blocks, query),
      currentFindMatchIndex: 0,
    });
  },

  nextFindMatch() {
    const { currentFindMatchIndex, findMatches } = get();
    if (findMatches.length === 0) return;
    const index = (currentFindMatchIndex + 1) % findMatches.length;
    set({ currentFindMatchIndex: index, pendingBlockIndex: findMatches[index] });
  },

  previousFindMatch() {
    const { currentFindMatchIndex, findMatches } = get();
    if (findMatches.length === 0) return;
    const index = (currentFindMatchIndex - 1 + findMatches.length) % findMatches.length;
    set({ currentFindMatchIndex: index, pendingBlockIndex: findMatches[index] });
  },

  async searchHistory(query) {
    const token = ++searchHistoryRequestToken;
    if (!query.trim()) {
      set({ globalHits: [] });
      return;
    }
    const hits = await get().api.searchHistory(query);
    if (token === searchHistoryRequestToken) {
      set({ globalHits: hits });
    }
  },

  async saveScrollPosition(scrollTop) {
    const { activeBlockIndex, api, blocks, document } = get();
    if (!document || blocks.length === 0) return;
    const blockIndex = Math.max(0, Math.min(blocks.length - 1, activeBlockIndex));
    await api.saveScrollPosition({
      path: document.path,
      blockIndex,
      blockFingerprint: bookmarkFingerprint(blocks[blockIndex] ?? ""),
      scrollTop: Math.max(0, Math.round(scrollTop)),
    });
  },

  setViewerScrollTop(scrollTop) {
    set({ viewerScrollTop: Math.max(0, scrollTop) });
  },

  setActiveBlockIndex(blockIndex) {
    const nextIndex = Math.max(0, Math.min(get().blocks.length - 1, blockIndex));
    if (get().activeBlockIndex === nextIndex) return;
    set({ activeBlockIndex: nextIndex });
  },

  setActiveTocHeadingId(id) {
    if (get().activeTocHeadingId === id) return;
    set({ activeTocHeadingId: id });
  },

  consumePendingScrollTop() {
    const scrollTop = get().pendingScrollTop;
    set({ pendingScrollTop: null });
    return scrollTop;
  },

  consumePendingBlockIndex() {
    const blockIndex = get().pendingBlockIndex;
    set({ pendingBlockIndex: null });
    return blockIndex;
  },

  async addBookmarkAtCurrentSpot() {
    const { activeBlockIndex, api, blocks, document, toc } = get();
    if (!document) return;
    const blockIndex = activeBlockIndex;
    const bookmark = await api.addBookmark({
      path: document.path,
      title: titleForBlock(toc, blockIndex, document.filename),
      blockIndex,
      blockFingerprint: bookmarkFingerprint(blocks[blockIndex] ?? ""),
    });
    set({ activeBookmarkId: bookmark.id });
    await get().refreshLists();
  },

  async openBookmark(id) {
    const bookmark = get().bookmarks.find((entry) => entry.id === id);
    if (!bookmark) return;
    await get().openDocument(bookmark.path);
    set({
      activeBookmarkId: bookmark.id,
      pendingBlockIndex: resolveBookmarkAnchor(
        get().blocks,
        bookmark.block_index,
        bookmark.block_fingerprint,
      ),
    });
  },

  async openBookmarkSlot(slot) {
    const bookmark = get().bookmarks[slot - 1];
    if (!bookmark) return;
    await get().openBookmark(bookmark.id);
  },

  async reorderBookmarks(ids) {
    const currentIds = get().bookmarks.map((bookmark) => bookmark.id);
    const sameSet = ids.length === currentIds.length && currentIds.every((id) => ids.includes(id));
    if (!sameSet) return;
    const bookmarks = await get().api.reorderBookmarks(ids);
    set({ bookmarks: [...bookmarks] });
  },

  setPlaceholder() {
    const { activeBlockIndex, blocks, document, toc, viewerScrollTop } = get();
    if (!document) return;
    set({
      activeBookmarkId: null,
      placeholder: {
        path: document.path,
        fragment: null,
        blockIndex: activeBlockIndex,
        blockFingerprint: bookmarkFingerprint(blocks[activeBlockIndex] ?? ""),
        title: titleForBlock(toc, activeBlockIndex, document.filename),
        scrollTop: viewerScrollTop,
      },
    });
  },

  async jumpToPlaceholder() {
    const { placeholder } = get();
    if (!placeholder) return;
    await get().openDocument(placeholder.path);
    set({
      activeBookmarkId: null,
      currentFragment: placeholder.fragment,
      pendingBlockIndex: resolveBookmarkAnchor(
        get().blocks,
        placeholder.blockIndex,
        placeholder.blockFingerprint ?? "",
      ),
      pendingScrollTop: placeholder.scrollTop ?? 0,
    });
  },

  clearPlaceholder() {
    set({ placeholder: null });
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
      activeBookmarkId: state.activeBookmarkId === id ? null : state.activeBookmarkId,
      bookmarks: state.bookmarks
        .filter((bookmark) => bookmark.id !== id)
        .map((bookmark, index) => ({ ...bookmark, sort_order: index })),
    }));
    await get().refreshLists();
  },

  cycleTheme() {
    const next = themes[(themes.indexOf(get().theme) + 1) % themes.length];
    get().setTheme(next);
  },

  setTheme(theme) {
    localStorage.setItem("mdv.theme", theme);
    set({ theme });
    rerenderCurrentDocument(set, get);
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

  resetZoom() {
    localStorage.setItem("mdv.zoom", "1");
    set({ zoom: 1 });
  },

  toggleInspector() {
    const inspectorVisible = !get().inspectorVisible;
    localStorage.setItem("mdv.inspector", String(inspectorVisible));
    set({ inspectorVisible });
  },

  toggleSidebar() {
    const sidebarVisible = !get().sidebarVisible;
    localStorage.setItem("mdv.sidebar", String(sidebarVisible));
    set({ sidebarVisible });
  },

  toggleLoadRemoteImages() {
    const loadRemoteImages = !get().loadRemoteImages;
    localStorage.setItem("mdv.loadRemoteImages", String(loadRemoteImages));
    set({ loadRemoteImages });
    rerenderCurrentDocument(set, get);
  },

  toggleSmartTypography() {
    const smartTypography = !get().smartTypography;
    localStorage.setItem("mdv.smartTypography", String(smartTypography));
    set({ smartTypography });
    rerenderCurrentDocument(set, get);
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
  if (stored === "paper") return "high-contrast";
  if (stored === "solarized") return "solarium-daylight";
  return themes.includes(stored as Theme) ? (stored as Theme) : "high-contrast";
}

export function readStoredNumber(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? value : fallback;
}

function rerenderCurrentDocument(set: (partial: Partial<AppState>) => void, get: () => AppState) {
  const { document, findQuery, loadRemoteImages, smartTypography, theme } = get();
  if (!document) return;
  const rendered = renderMarkdown(document.content, {
    loadRemoteImages,
    typographer: smartTypography && smartTypographyAllowed(theme),
  });
  set({
    html: rendered.html,
    blocks: rendered.blocks,
    toc: rendered.toc,
    activeTocHeadingId: rendered.toc[0]?.id ?? null,
    findMatches: findBlockMatches(rendered.blocks, findQuery),
  });
}

function smartTypographyAllowed(theme: Theme): boolean {
  return !["phosphor", "standard-erin-light", "standard-erin-dark"].includes(theme);
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

function snapshotFor(
  path: string,
  fragment: string | null,
  blockIndex: number,
): NavigationSnapshot {
  return { path, fragment, blockIndex };
}

function titleForBlock(toc: TocHeading[], blockIndex: number, fallback: string) {
  const heading = [...toc].reverse().find((entry) => entry.blockIndex <= blockIndex);
  return heading?.text ?? fallback;
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
