import {
  DndContext,
  type DragEndEvent,
  type DraggableAttributes,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCss } from "@dnd-kit/utilities";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { hasShellPrompts, stripShellPrompts } from "./codeBlocks";
import { canInlineHighlightMarkdownBlock } from "./markdown";
import { smartTypographyAllowed, type Theme, themes, useAppStore } from "./store";
import type { Bookmark, HistoryEntry, SearchHit, TocHeading } from "./types";

const loadedRemoteImages = new Set<string>();

type IconName =
  | "bookmark"
  | "bookmarkFill"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp"
  | "checkmark"
  | "docOnDoc"
  | "docText"
  | "listBulletIndent"
  | "magnifyingglass"
  | "paintpalette"
  | "pencil"
  | "pinFill"
  | "plus"
  | "sidebarRight"
  | "textAlignleft"
  | "textAppend"
  | "trash"
  | "xmark";

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredNumber("mdv.sidebarWidth", 240));
  const [sidebarHandleHovered, setSidebarHandleHovered] = useState(false);
  const sidebarResizeRef = useRef<{ x: number; width: number } | null>(null);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const zoomHudTimerRef = useRef<number | undefined>(undefined);
  const previousZoomRef = useRef<number | null>(null);
  const theme = useAppStore((state) => state.theme);
  const zoom = useAppStore((state) => state.zoom);
  const api = useAppStore((state) => state.api);
  const currentDocument = useAppStore((state) => state.document);
  const html = useAppStore((state) => state.html);
  const backStack = useAppStore((state) => state.backStack);
  const bookmarks = useAppStore((state) => state.bookmarks);
  const editorAppPath = useAppStore((state) => state.editorAppPath);
  const inspectorVisible = useAppStore((state) => state.inspectorVisible);
  const loadRemoteImages = useAppStore((state) => state.loadRemoteImages);
  const addBookmarkAtCurrentSpot = useAppStore((state) => state.addBookmarkAtCurrentSpot);
  const chooseAndOpenDocument = useAppStore((state) => state.chooseAndOpenDocument);
  const chooseAndOpenDocumentInNewWindow = useAppStore(
    (state) => state.chooseAndOpenDocumentInNewWindow,
  );
  const chooseEditor = useAppStore((state) => state.chooseEditor);
  const editCurrentFile = useAppStore((state) => state.editCurrentFile);
  const forgetEditor = useAppStore((state) => state.forgetEditor);
  const jumpToPlaceholder = useAppStore((state) => state.jumpToPlaceholder);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateForward = useAppStore((state) => state.navigateForward);
  const openFirstPath = useAppStore((state) => state.openFirstPath);
  const refreshLists = useAppStore((state) => state.refreshLists);
  const reloadCurrentDocumentFromDisk = useAppStore((state) => state.reloadCurrentDocumentFromDisk);
  const resetZoom = useAppStore((state) => state.resetZoom);
  const setTheme = useAppStore((state) => state.setTheme);
  const setPlaceholder = useAppStore((state) => state.setPlaceholder);
  const sidebarVisible = useAppStore((state) => state.sidebarVisible);
  const smartTypography = useAppStore((state) => state.smartTypography);
  const toggleInspector = useAppStore((state) => state.toggleInspector);
  const toggleLoadRemoteImages = useAppStore((state) => state.toggleLoadRemoteImages);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const toggleSmartTypography = useAppStore((state) => state.toggleSmartTypography);
  const zoomIn = useAppStore((state) => state.zoomIn);
  const zoomOut = useAppStore((state) => state.zoomOut);
  const forwardStack = useAppStore((state) => state.forwardStack);
  const clampedSidebarWidth = Math.min(400, Math.max(180, sidebarWidth));

  const stopSidebarResize = () => {
    if (!sidebarResizeRef.current) return;
    sidebarResizeRef.current = null;
    window.removeEventListener("pointermove", onSidebarResizePointerMove);
    window.removeEventListener("pointerup", stopSidebarResize);
  };

  const onSidebarResizePointerMove = (event: PointerEvent) => {
    const start = sidebarResizeRef.current;
    if (!start) return;
    const nextWidth = Math.min(400, Math.max(180, start.width + event.clientX - start.x));
    localStorage.setItem("mdv.sidebarWidth", String(nextWidth));
    setSidebarWidth(nextWidth);
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarResizeRef.current = { x: event.clientX, width: clampedSidebarWidth };
    window.addEventListener("pointermove", onSidebarResizePointerMove);
    window.addEventListener("pointerup", stopSidebarResize);
  };

  const openIncomingPaths = useCallback(
    async (paths: string[]) => {
      const path = paths[0];
      if (!path) return;
      if (path === currentDocument?.path) {
        await reloadCurrentDocumentFromDisk();
        return;
      }
      await openFirstPath(paths);
    },
    [currentDocument?.path, openFirstPath, reloadCurrentDocumentFromDisk],
  );

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--zoom", String(zoom));
  }, [theme, zoom]);

  useEffect(() => {
    if (previousZoomRef.current === null) {
      previousZoomRef.current = zoom;
      return;
    }
    if (previousZoomRef.current === zoom) return;
    previousZoomRef.current = zoom;
    setZoomHudVisible(true);
    if (zoomHudTimerRef.current !== undefined) window.clearTimeout(zoomHudTimerRef.current);
    zoomHudTimerRef.current = window.setTimeout(() => setZoomHudVisible(false), 900);
  }, [zoom]);

  useEffect(
    () => () => {
      if (zoomHudTimerRef.current !== undefined) window.clearTimeout(zoomHudTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [zoomIn, zoomOut]);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void api
      .subscribeToSharedStateChanges(async () => {
        await refreshLists();
      })
      .then((nextUnsubscribe) => {
        if (cancelled) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, refreshLists]);

  useEffect(() => {
    void api.updateNativeMenuState?.({
      hasDocument: Boolean(currentDocument),
      hasEditor: Boolean(editorAppPath),
      canGoBack: backStack.length > 0,
      canGoForward: forwardStack.length > 0,
      sidebarVisible,
      smartTypography,
      smartTypographyAllowed: smartTypographyAllowed(theme),
      loadRemoteImages,
      bookmarkSlots: Array.from({ length: 5 }, (_, index) => {
        const bookmark = bookmarks[index];
        return {
          title: bookmark ? bookmark.title : `Slot ${index + 1} — Empty`,
          enabled: Boolean(bookmark?.file_exists),
        };
      }),
    });
  }, [
    api,
    backStack.length,
    bookmarks,
    currentDocument,
    editorAppPath,
    forwardStack.length,
    loadRemoteImages,
    sidebarVisible,
    smartTypography,
    theme,
  ]);

  useEffect(() => {
    const initialPath = new URLSearchParams(window.location.search).get("mdvOpenPath");
    if (initialPath) void openFirstPath([initialPath]);
  }, [openFirstPath]);

  useEffect(() => {
    if (!currentDocument) return;
    let cancelled = false;
    let signature = {
      file_mtime_ms: currentDocument.file_mtime_ms,
      file_size: currentDocument.file_size,
    };
    let reloadTimer: number | undefined;
    const check = async () => {
      const next = await api.fileSignature(currentDocument.path).catch(() => null);
      if (cancelled || !next) return;
      if (
        next.file_mtime_ms === signature.file_mtime_ms &&
        next.file_size === signature.file_size
      ) {
        return;
      }
      signature = { file_mtime_ms: next.file_mtime_ms, file_size: next.file_size };
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        if (!cancelled) void reloadCurrentDocumentFromDisk();
      }, 250);
    };
    const interval = window.setInterval(() => {
      void check();
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
    };
  }, [
    api,
    currentDocument,
    currentDocument?.file_mtime_ms,
    currentDocument?.file_size,
    currentDocument?.path,
    reloadCurrentDocumentFromDisk,
  ]);

  useEffect(() => {
    if (!currentDocument || !html) return;
    let cancelled = false;
    const capture = async () => {
      const outputPath = await api.instrumentationCapturePath?.();
      if (!outputPath || cancelled) return;
      window.setTimeout(() => {
        if (!cancelled) void api.captureTauriWindow?.(outputPath);
      }, 900);
    };
    void capture();
    return () => {
      cancelled = true;
    };
  }, [api, currentDocument, html]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void api
      .subscribeToFileDrops(async (paths) => {
        await openIncomingPaths(paths);
      })
      .then((nextUnsubscribe) => {
        if (cancelled) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, openIncomingPaths]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateBack();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void navigateForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBack, navigateForward]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void api.takePendingOpenPaths().then((paths) => openIncomingPaths(paths));
    void api
      .subscribeToOpenRequests(async (paths) => {
        await openIncomingPaths(paths);
      })
      .then((nextUnsubscribe) => {
        if (cancelled) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, openIncomingPaths]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void api
      .subscribeToMenuCommands(async (command) => {
        switch (command) {
          case "install-cli":
            window.alert(await api.installCli());
            break;
          case "open":
            await chooseAndOpenDocument();
            break;
          case "open-new-window":
            await chooseAndOpenDocumentInNewWindow();
            break;
          case "edit-current-file":
            await editCurrentFile();
            break;
          case "choose-editor":
            await chooseEditor();
            break;
          case "forget-editor":
            forgetEditor();
            break;
          case "find":
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
            break;
          case "search-history":
            window.dispatchEvent(new CustomEvent("mdv:focus-history-search", { bubbles: false }));
            break;
          case "back":
            await navigateBack();
            break;
          case "forward":
            await navigateForward();
            break;
          case "toggle-sidebar":
            toggleSidebar();
            break;
          case "zoom-in":
            zoomIn();
            break;
          case "zoom-out":
            zoomOut();
            break;
          case "actual-size":
            resetZoom();
            break;
          case "smart-typography":
            toggleSmartTypography();
            break;
          case "load-remote-images":
            toggleLoadRemoteImages();
            break;
          case "bookmark-current-spot":
            await addBookmarkAtCurrentSpot();
            break;
          case "set-placeholder":
            setPlaceholder();
            break;
          case "jump-to-placeholder":
            await jumpToPlaceholder();
            break;
          case "toggle-inspector":
            toggleInspector();
            break;
          case "theme-paper":
          case "theme-high-contrast":
            setTheme("high-contrast");
            break;
          case "theme-charcoal":
            setTheme("charcoal");
            break;
          case "theme-solarized":
          case "theme-solarium-daylight":
            setTheme("solarium-daylight");
            break;
          case "theme-system":
          case "theme-sevilla":
          case "theme-solarium-moonlight":
          case "theme-phosphor":
          case "theme-twilight":
          case "theme-standard-erin-light":
          case "theme-standard-erin-dark":
            setTheme(command.slice("theme-".length) as Theme);
            break;
          default:
            if (command.startsWith("bookmark-slot-")) {
              const slot = Number(command.at(-1));
              if (Number.isInteger(slot)) await useAppStore.getState().openBookmarkSlot(slot);
            }
        }
      })
      .then((nextUnsubscribe) => {
        if (cancelled) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    addBookmarkAtCurrentSpot,
    api,
    chooseAndOpenDocument,
    chooseAndOpenDocumentInNewWindow,
    chooseEditor,
    editCurrentFile,
    forgetEditor,
    jumpToPlaceholder,
    navigateBack,
    navigateForward,
    resetZoom,
    setTheme,
    setPlaceholder,
    toggleInspector,
    toggleLoadRemoteImages,
    toggleSidebar,
    toggleSmartTypography,
    zoomIn,
    zoomOut,
  ]);

  return (
    <main className="relative grid h-screen overflow-hidden grid-rows-[auto_minmax(0,1fr)] bg-[var(--bg)] text-[var(--chrome-text)]">
      <TopBar />
      <div
        className="mdv-app-shell grid min-h-0 transition-[grid-template-columns] duration-[220ms] ease-out"
        data-sidebar-visible={sidebarVisible ? "true" : "false"}
        data-testid="app-shell"
        style={
          {
            "--mdv-shell-columns": sidebarVisible
              ? `${clampedSidebarWidth}px 8px minmax(0,1fr) ${inspectorVisible ? 240 : 0}px`
              : `0px 6px minmax(0,1fr) ${inspectorVisible ? 240 : 0}px`,
          } as CSSProperties
        }
      >
        <Sidebar visible={sidebarVisible} />
        <SidebarDivider
          hovered={sidebarHandleHovered}
          visible={sidebarVisible}
          onCollapse={toggleSidebar}
          onExpand={toggleSidebar}
          onHover={setSidebarHandleHovered}
          onResizeStart={startSidebarResize}
        />
        <Viewer />
        <Inspector />
      </div>
      {zoomHudVisible ? <ZoomHud zoom={zoom} /> : null}
    </main>
  );
}

function ZoomHud({ zoom }: { zoom: number }) {
  return (
    <div className="mdv-zoom-hud" aria-live="polite" data-testid="zoom-hud">
      {Math.round(zoom * 100)}%
    </div>
  );
}

function TopBar() {
  const chooseAndOpenDocument = useAppStore((state) => state.chooseAndOpenDocument);
  const document = useAppStore((state) => state.document);
  const editCurrentFile = useAppStore((state) => state.editCurrentFile);
  const bookmarks = useAppStore((state) => state.bookmarks);
  const addBookmarkAtCurrentSpot = useAppStore((state) => state.addBookmarkAtCurrentSpot);
  const inspectorVisible = useAppStore((state) => state.inspectorVisible);
  const setTheme = useAppStore((state) => state.setTheme);
  const theme = useAppStore((state) => state.theme);
  const toggleInspector = useAppStore((state) => state.toggleInspector);
  const hasAnyBookmarkForCurrentFile = Boolean(
    document && bookmarks.some((bookmark) => bookmark.path === document.path),
  );

  return (
    <header className="relative z-30 grid h-12 min-w-0 grid-cols-[minmax(110px,1fr)_auto] items-center border-[var(--border)] border-b bg-[var(--titlebar)] pr-3 pl-5">
      <div className="min-w-0">
        <div className="truncate font-bold text-[var(--title-text)] text-base">
          {document?.filename ?? "mdv"}
        </div>
      </div>

      <div
        className="flex min-w-0 items-center justify-end gap-1 text-[var(--toolbar-icon)] md:gap-2"
        data-testid="app-toolbar"
      >
        <button
          className="mdv-icon-button"
          type="button"
          aria-label="Open"
          onClick={() => void chooseAndOpenDocument()}
        >
          <Icon name="plus" />
        </button>
        <button
          className="mdv-icon-button"
          type="button"
          aria-label="Edit Current File"
          disabled={!document}
          onClick={() => void editCurrentFile()}
        >
          <Icon name="pencil" />
        </button>
        <ThemeMenu selected={theme} onSelect={setTheme} />
        <button
          className="mdv-icon-button"
          type="button"
          aria-label="Bookmark"
          disabled={!document}
          onClick={() => void addBookmarkAtCurrentSpot()}
        >
          <Icon name={hasAnyBookmarkForCurrentFile ? "bookmarkFill" : "bookmark"} />
        </button>
        <button
          className={`mdv-icon-button ${inspectorVisible ? "text-[var(--accent)]" : ""}`}
          type="button"
          aria-label="Table of contents"
          onClick={toggleInspector}
        >
          <Icon name="sidebarRight" />
        </button>
      </div>
    </header>
  );
}

function SidebarDivider({
  hovered,
  onCollapse,
  onExpand,
  onHover,
  onResizeStart,
  visible,
}: {
  hovered: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onHover: (hovered: boolean) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  visible: boolean;
}) {
  if (!visible) {
    return (
      <div
        className="mdv-sidebar-divider group relative z-40 min-w-[6px] cursor-default place-items-start bg-[var(--bg)] pt-3"
        data-testid="sidebar-edge-gutter"
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        <div
          className={`absolute top-0 bottom-0 left-0 ${
            hovered ? "w-0.5 bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]" : "w-px"
          } transition-all duration-150`}
        />
        <button
          className="mt-1 grid h-[22px] w-4 place-items-center rounded border border-[var(--divider)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] text-[var(--text)] opacity-80"
          type="button"
          aria-label="Show Sidebar"
          onClick={onExpand}
        >
          <Icon name="chevronRight" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="mdv-sidebar-divider relative z-40 min-w-2 cursor-ew-resize place-items-start bg-[var(--bg)] pt-3"
      data-testid="sidebar-resizer"
      onPointerDown={onResizeStart}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div
        className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 ${
          hovered
            ? "w-0.5 bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
            : "w-px bg-[var(--divider)]"
        } transition-all duration-150`}
      />
      <button
        className={`relative z-50 mt-1 grid h-[22px] w-4 place-items-center rounded border border-[var(--divider)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] text-[var(--text)] transition-opacity duration-[180ms] ${
          hovered ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        type="button"
        aria-label="Hide Sidebar"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onCollapse}
      >
        <Icon name="chevronLeft" />
      </button>
    </div>
  );
}

function ThemeMenu({ onSelect, selected }: { onSelect: (theme: Theme) => void; selected: Theme }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const labels: Record<Theme, string> = {
    system: "System",
    "high-contrast": "High Contrast",
    sevilla: "Sevilla",
    charcoal: "Charcoal",
    "solarium-daylight": "Solarium Daylight",
    "solarium-moonlight": "Solarium Moonlight",
    phosphor: "Phosphor",
    twilight: "Twilight",
    "standard-erin-light": "Standard Erin Light",
    "standard-erin-dark": "Standard Erin Dark",
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="mdv-icon-button"
        type="button"
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
      >
        <Icon name="paintpalette" />
      </button>
      {open ? (
        <div
          className="absolute top-9 right-0 z-50 min-w-48 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-lg"
          role="menu"
          data-testid="theme-menu"
        >
          {themes.map((id) => (
            <button
              key={id}
              className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--panel-strong)]"
              type="button"
              role="menuitemradio"
              aria-checked={selected === id}
              onClick={() => {
                onSelect(id);
                setOpen(false);
              }}
            >
              <span className="grid place-items-center" aria-hidden="true">
                {selected === id ? <Icon name="checkmark" /> : null}
              </span>
              <span>{labels[id]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({ visible }: { visible: boolean }) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchHistory = useAppStore((state) => state.searchHistory);
  const globalHits = useAppStore((state) => state.globalHits);
  const history = useAppStore((state) => state.history);

  const closeHistorySearch = () => {
    setSearchQuery("");
    void searchHistory("");
    setSearchVisible(false);
  };

  const focusHistorySearch = () => {
    markFocusedPane("sidebar");
    setSearchVisible(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  useEffect(() => {
    const onFocusHistorySearch = () => focusHistorySearch();
    window.addEventListener("mdv:focus-history-search", onFocusHistorySearch);
    return () => window.removeEventListener("mdv:focus-history-search", onFocusHistorySearch);
  });

  return (
    <aside
      aria-label="History"
      aria-hidden={!visible}
      className={`mdv-history-panel max-h-[260px] overflow-auto border-[var(--border)] border-b bg-[var(--panel)] lg:max-h-none lg:border-r lg:border-b-0 ${
        visible ? "" : "pointer-events-none"
      }`}
      data-testid="history-panel"
      onFocusCapture={() => markFocusedPane("sidebar")}
      onPointerDown={() => markFocusedPane("sidebar")}
    >
      <div className="grid gap-2 px-3 pt-8 pb-2 text-[var(--muted)] text-xs uppercase">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="history-search">History</label>
          <button
            className="mdv-pane-icon-button"
            type="button"
            aria-label="Search history"
            onClick={() => {
              if (searchVisible) closeHistorySearch();
              else focusHistorySearch();
            }}
          >
            <Icon name="magnifyingglass" />
          </button>
        </div>
        <div
          className="mdv-collapsible"
          data-open={searchVisible ? "true" : "false"}
          data-testid="history-search-pod"
        >
          <div className="grid gap-1.5">
            <label className="mdv-pane-search">
              <Icon name="magnifyingglass" />
              <input
                id="history-search"
                ref={searchInputRef}
                placeholder="Search history"
                value={searchQuery}
                onChange={(event) => {
                  const query = event.currentTarget.value;
                  setSearchQuery(query);
                  void searchHistory(query);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeHistorySearch();
                }}
              />
              <button type="button" aria-label="Close history search" onClick={closeHistorySearch}>
                <Icon name="xmark" />
              </button>
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-0.5 p-2 pt-1" data-testid="history-list">
        {globalHits.length > 0 ? (
          <SearchHits hits={globalHits} query={searchQuery} />
        ) : (
          <HistoryRows history={history} />
        )}
      </div>
    </aside>
  );
}

function markFocusedPane(pane: "sidebar" | "viewer") {
  document.documentElement.dataset.mdvFocusedPane = pane;
}

function shouldRouteFindToHistorySearch() {
  const activeElement = document.activeElement;
  if (activeElement?.closest?.("aside[aria-label='History']")) return true;
  return document.documentElement.dataset.mdvFocusedPane === "sidebar";
}

function Viewer() {
  const [findVisible, setFindVisible] = useState(false);
  const [codeMenu, setCodeMenu] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const ignoreScrollUntilRef = useRef(0);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const document = useAppStore((state) => state.document);
  const findQuery = useAppStore((state) => state.findQuery);
  const findMatches = useAppStore((state) => state.findMatches);
  const currentFindMatchIndex = useAppStore((state) => state.currentFindMatchIndex);
  const currentFragment = useAppStore((state) => state.currentFragment);
  const html = useAppStore((state) => state.html);
  const loadRemoteImages = useAppStore((state) => state.loadRemoteImages);
  const pendingBlockIndex = useAppStore((state) => state.pendingBlockIndex);
  const pendingScrollTop = useAppStore((state) => state.pendingScrollTop);
  const blocks = useAppStore((state) => state.blocks);
  const toc = useAppStore((state) => state.toc);
  const consumePendingBlockIndex = useAppStore((state) => state.consumePendingBlockIndex);
  const consumePendingScrollTop = useAppStore((state) => state.consumePendingScrollTop);
  const api = useAppStore((state) => state.api);
  const navigateToHref = useAppStore((state) => state.navigateToHref);
  const nextFindMatch = useAppStore((state) => state.nextFindMatch);
  const previousFindMatch = useAppStore((state) => state.previousFindMatch);
  const saveScrollPosition = useAppStore((state) => state.saveScrollPosition);
  const setActiveBlockIndex = useAppStore((state) => state.setActiveBlockIndex);
  const setActiveTocHeadingId = useAppStore((state) => state.setActiveTocHeadingId);
  const setFindQuery = useAppStore((state) => state.setFindQuery);
  const setViewerScrollTop = useAppStore((state) => state.setViewerScrollTop);
  const handleMarkdownLink = (target: EventTarget | null): boolean => {
    const anchor = (target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return false;
    void navigateToHref(anchor.getAttribute("href") ?? "");
    return true;
  };
  const codeBlockForId = (blockId: string): HTMLElement | null =>
    scrollRef.current?.querySelector<HTMLElement>(
      `.mdv-code-block[data-code-block-id="${blockId}"]`,
    ) ?? null;
  const handleCodeAction = (target: EventTarget | null): boolean => {
    const action = (target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-code-action]");
    if (!action) return false;
    const block = action.closest<HTMLElement>(".mdv-code-block");
    if (!block) return false;
    if (action.dataset.codeAction === "wrap") {
      toggleCodeWrap(block);
      return true;
    }
    if (action.dataset.codeAction === "copy") {
      void copyCodeBlock(block, false);
      return true;
    }
    return false;
  };
  const handleHeadingCopy = (target: EventTarget | null): boolean => {
    const heading = (target as HTMLElement | null)?.closest<HTMLElement>(
      ".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6",
    );
    if (!heading?.dataset.mdvBlockIndex) return false;
    const blockIndex = Number(heading.dataset.mdvBlockIndex);
    if (!Number.isFinite(blockIndex)) return false;
    const level = Number(heading.tagName.slice(1));
    const nextPeer = toc.find((entry) => entry.blockIndex > blockIndex && entry.level <= level);
    const endIndex = nextPeer?.blockIndex ?? blocks.length;
    const markdown = blocks.slice(blockIndex, endIndex).join("\n\n");
    if (!markdown.trim()) return false;
    void navigator.clipboard.writeText(markdown).catch(() => {});
    flashCopiedSection(blockIndex, endIndex);
    return true;
  };
  const flashCopiedSection = (startIndex: number, endIndex: number) => {
    const root = markdownRef.current;
    if (!root) return;
    for (const block of root.querySelectorAll(".mdv-heading-copy-flash")) {
      block.classList.remove("mdv-heading-copy-flash");
    }
    const flashed = Array.from(root.querySelectorAll<HTMLElement>("[data-mdv-block-index]")).filter(
      (block) => {
        const index = Number(block.dataset.mdvBlockIndex);
        return Number.isFinite(index) && index >= startIndex && index < endIndex;
      },
    );
    for (const block of flashed) block.classList.add("mdv-heading-copy-flash");
    window.setTimeout(() => {
      for (const block of flashed) block.classList.remove("mdv-heading-copy-flash");
    }, 650);
  };

  useEffect(() => {
    if (!document || pendingScrollTop === null) return;
    const scrollTop = consumePendingScrollTop();
    if (scrollTop === null) return;
    ignoreScrollUntilRef.current = Date.now() + 250;
    window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
    });
  }, [consumePendingScrollTop, document, pendingScrollTop]);

  useEffect(() => {
    if (!document || pendingBlockIndex === null) return;
    const blockIndex = consumePendingBlockIndex();
    if (blockIndex === null) return;
    ignoreScrollUntilRef.current = Date.now() + 250;
    window.requestAnimationFrame(() => {
      const block = scrollRef.current?.querySelector<HTMLElement>(
        `[data-mdv-block-index="${blockIndex}"]`,
      );
      if (block) {
        block.scrollIntoView({ block: "start" });
        return;
      }
      if (scrollRef.current) scrollRef.current.scrollTop = blockIndex * 220;
    });
  }, [consumePendingBlockIndex, document, pendingBlockIndex]);

  useEffect(() => {
    if (!document || !currentFragment || !scrollRef.current) return;
    ignoreScrollUntilRef.current = Date.now() + 250;
    window.requestAnimationFrame(() => {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `#${CSS.escape(currentFragment)}`,
      );
      target?.scrollIntoView({ block: "start" });
    });
  }, [currentFragment, document, html]);

  useLayoutEffect(() => {
    if (!document) return;
    let cancelled = false;
    const resolveImages = () => {
      const root = markdownRef.current ?? scrollRef.current;
      if (!root || cancelled) return;
      const images = Array.from(
        root.querySelectorAll<HTMLImageElement>("img[data-mdv-local-image]"),
      );
      for (const image of images) {
        const src = image.dataset.mdvLocalImage;
        if (
          !src ||
          image.dataset.imageState === "resolving" ||
          image.dataset.imageState === "loaded"
        ) {
          continue;
        }
        image.dataset.imageState = "resolving";
        void api
          .resolveLocalImage(document.path, src)
          .then((resolved) => {
            if (cancelled) return;
            const currentRoot = markdownRef.current ?? scrollRef.current;
            const currentImages = Array.from(
              currentRoot?.querySelectorAll<HTMLImageElement>("img[data-mdv-local-image]") ?? [],
            ).filter((currentImage) => currentImage.dataset.mdvLocalImage === src);
            if (resolved.exists) {
              const url = api.localImageUrl(resolved.path);
              for (const currentImage of currentImages) {
                currentImage.dataset.imageState = "loaded";
                currentImage.src = url;
              }
              return;
            }
            for (const currentImage of currentImages) {
              const placeholder = documentPlaceholder(
                `image not found: ${filenameForPath(resolved.path)}`,
              );
              currentImage.replaceWith(placeholder);
            }
          })
          .catch(() => {
            if (cancelled) return;
            const currentRoot = markdownRef.current ?? scrollRef.current;
            const currentImages = Array.from(
              currentRoot?.querySelectorAll<HTMLImageElement>("img[data-mdv-local-image]") ?? [],
            ).filter((currentImage) => currentImage.dataset.mdvLocalImage === src);
            for (const currentImage of currentImages) {
              const placeholder = documentPlaceholder(`image not found: ${filenameForPath(src)}`);
              currentImage.replaceWith(placeholder);
            }
          });
      }
    };
    resolveImages();
    const frame = window.requestAnimationFrame(resolveImages);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [api, document, html]);

  useEffect(() => {
    if (!loadRemoteImages || !markdownRef.current) return;
    const images = Array.from(
      markdownRef.current.querySelectorAll<HTMLImageElement>(
        "img.mdv-image:not([data-mdv-local-image])",
      ),
    ).filter((image) => isRemoteUrl(image.getAttribute("src") ?? ""));
    for (const image of images) {
      const src = image.getAttribute("src") ?? "";
      if (loadedRemoteImages.has(src)) {
        image.dataset.imageState = "loaded";
        continue;
      }
      image.dataset.imageState = "loading";
      const onLoad = () => {
        loadedRemoteImages.add(src);
        image.dataset.imageState = "loaded";
      };
      const onError = () => {
        const placeholder = documentPlaceholder("Couldn't load remote image", "remote-error");
        const host = window.document.createElement("span");
        host.textContent = remoteHostLabel(src);
        placeholder.append(host);
        image.replaceWith(placeholder);
      };
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
      if (image.complete) {
        if (image.naturalWidth > 0) onLoad();
        else onError();
      }
    }
  }, [html, loadRemoteImages]);

  useLayoutEffect(() => {
    if (!markdownRef.current) return;
    enhanceCodeBlocks(markdownRef.current);
  }, [html]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const focusFind = () => {
      setFindVisible(true);
      window.requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLInputElement>("[data-testid='document-find']")
          ?.focus();
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }
      event.preventDefault();
      if (shouldRouteFindToHistorySearch()) {
        window.dispatchEvent(new CustomEvent("mdv:focus-history-search", { bubbles: false }));
        return;
      }
      focusFind();
    };
    const onOpenFind = () => focusFind();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mdv:open-find", onOpenFind);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mdv:open-find", onOpenFind);
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      setViewerScrollTop(element.scrollTop);
      setActiveBlockIndex(topVisibleBlockIndex(element));
      setActiveTocHeadingId(topVisibleHeadingId(element));
      scheduleScrollSave(element.scrollTop);
    };
    element.addEventListener("scroll", onScroll);
    onScroll();
    return () => element.removeEventListener("scroll", onScroll);
  }, [html, setActiveBlockIndex, setActiveTocHeadingId, setViewerScrollTop]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    clearInlineFindMarks(element);
    for (const block of element.querySelectorAll("[data-mdv-block-index]")) {
      block.classList.remove("mdv-find-match-block", "mdv-find-current-block");
    }
    if (findMatches.length === 0 || findQuery.trim().length === 0) return;
    const currentMatch = findMatches[currentFindMatchIndex];
    for (const blockIndex of findMatches) {
      const block = element.querySelector(`[data-mdv-block-index="${blockIndex}"]`);
      block?.classList.add("mdv-find-match-block");
      if (blockIndex === currentMatch) block?.classList.add("mdv-find-current-block");
      const rawBlock = blocks[blockIndex];
      if (block && rawBlock && canInlineHighlightMarkdownBlock(rawBlock)) {
        highlightInlineFindMatches(block, findQuery);
      }
    }
  }, [blocks, currentFindMatchIndex, findMatches, findQuery, html, pendingBlockIndex]);

  const scheduleScrollSave = (scrollTop: number) => {
    if (Date.now() < ignoreScrollUntilRef.current) return;
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveScrollPosition(scrollTop);
    }, 80);
  };

  return (
    <section
      ref={scrollRef}
      className="min-w-0 overflow-auto bg-[var(--bg)]"
      data-testid="viewer-scroll"
      onFocusCapture={() => markFocusedPane("viewer")}
      onPointerDown={() => markFocusedPane("viewer")}
    >
      <article
        className="markdown-body relative mx-auto max-w-[760px] px-6 py-10 md:px-11 md:py-12"
        data-current-fragment={currentFragment ?? undefined}
        data-testid="markdown-body"
        onClick={(event) => {
          if (handleCodeAction(event.target)) {
            event.preventDefault();
            return;
          }
          if (handleMarkdownLink(event.target)) {
            event.preventDefault();
            return;
          }
          if (handleHeadingCopy(event.target)) event.preventDefault();
        }}
        onContextMenu={(event) => {
          const block = (event.target as HTMLElement | null)?.closest<HTMLElement>(
            ".mdv-code-block",
          );
          if (!block?.dataset.codeBlockId) return;
          event.preventDefault();
          setCodeMenu({ blockId: block.dataset.codeBlockId, x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (handleMarkdownLink(event.target)) event.preventDefault();
        }}
      >
        {findVisible ? (
          <div className="sticky top-3 z-10 float-right mb-2 ml-4 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[var(--muted)] text-xs shadow-sm">
            <Icon name="magnifyingglass" />
            <input
              className="mdv-find-input"
              data-testid="document-find"
              placeholder="Find"
              value={findQuery}
              onChange={(event) => setFindQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setFindVisible(false);
              }}
            />
            {findMatches.length > 0 ? (
              <span>
                {currentFindMatchIndex + 1}/{findMatches.length}
              </span>
            ) : null}
            <button
              className="mdv-find-button"
              type="button"
              aria-label="Previous match"
              disabled={findMatches.length === 0}
              onClick={previousFindMatch}
            >
              <Icon name="chevronUp" />
            </button>
            <button
              className="mdv-find-button"
              type="button"
              aria-label="Next match"
              disabled={findMatches.length === 0}
              onClick={nextFindMatch}
            >
              <Icon name="chevronDown" />
            </button>
            <button
              className="mdv-find-button"
              type="button"
              aria-label="Close find"
              onClick={() => setFindVisible(false)}
            >
              <Icon name="xmark" />
            </button>
          </div>
        ) : null}
        {document ? (
          <>
            {findMatches.length > 0 ? (
              <div className="float-right sticky top-20 rounded-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-[var(--muted)] text-xs">
                {findMatches.length} block matches
              </div>
            ) : null}
            <div ref={markdownRef} dangerouslySetInnerHTML={{ __html: html }} />
            {codeMenu ? (
              <CodeBlockMenu
                block={codeBlockForId(codeMenu.blockId)}
                menu={codeMenu}
                onClose={() => setCodeMenu(null)}
              />
            ) : null}
          </>
        ) : (
          <div className="py-[12vh] text-center text-[var(--muted)]">
            <h1 className="font-semibold text-4xl text-[var(--text)]">mdv</h1>
            <p>A native Markdown viewer for macOS.</p>
          </div>
        )}
      </article>
    </section>
  );
}

function CodeBlockMenu({
  block,
  menu,
  onClose,
}: {
  block: HTMLElement | null;
  menu: { blockId: string; x: number; y: number };
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);

  if (!block) return null;
  const left = Math.min(menu.x, window.innerWidth - 180);
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 132));
  const code = codeText(block);
  const language = codeLanguage(block);
  const canCopyWithoutPrompts = hasShellPrompts(code, language);

  return (
    <div
      className="mdv-context-menu"
      role="menu"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuButton
        disabled={false}
        onClick={() => {
          void copyCodeBlock(block, false);
          onClose();
        }}
      >
        Copy Code
      </MenuButton>
      <MenuButton
        disabled={false}
        onClick={() => {
          toggleCodeWrap(block);
          onClose();
        }}
      >
        {block.classList.contains("mdv-code-wrap") ? "Disable Wrap" : "Wrap Long Lines"}
      </MenuButton>
      {canCopyWithoutPrompts ? (
        <MenuButton
          disabled={false}
          onClick={() => {
            void copyCodeBlock(block, true);
            onClose();
          }}
        >
          Copy Without Prompts
        </MenuButton>
      ) : null}
    </div>
  );
}

function enhanceCodeBlocks(root: HTMLElement) {
  const blocks = Array.from(root.querySelectorAll<HTMLPreElement>("pre.code-block"));
  blocks.forEach((pre, index) => {
    if (pre.closest(".mdv-code-block")) return;
    const code = pre.querySelector<HTMLElement>("code");
    const language = pre.dataset.mdvCodeLanguage ?? "";
    const wrapper = document.createElement("div");
    wrapper.className = "mdv-code-block";
    wrapper.dataset.codeBlockId = `code-${index}`;
    wrapper.dataset.codeLanguage = language;
    wrapper.dataset.hasShellPrompts = String(hasShellPrompts(code?.textContent ?? "", language));

    const chrome = document.createElement("div");
    chrome.className = "mdv-code-chrome";

    const label = document.createElement("span");
    label.className = "mdv-code-language";
    label.textContent = language;

    const toolbar = document.createElement("div");
    toolbar.className = "mdv-code-toolbar";
    toolbar.append(
      codeIconButton("wrap", "Wrap long lines", "text.append"),
      codeIconButton("copy", "Copy code", "doc.on.doc"),
    );

    chrome.append(label, toolbar);
    pre.replaceWith(wrapper);
    wrapper.append(chrome, pre);
  });
}

function codeIconButton(action: "copy" | "wrap", label: string, symbol: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mdv-code-button";
  button.dataset.codeAction = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = iconMarkup(symbol);
  return button;
}

function toggleCodeWrap(block: HTMLElement) {
  const wrapped = block.classList.toggle("mdv-code-wrap");
  const button = block.querySelector<HTMLButtonElement>('[data-code-action="wrap"]');
  if (!button) return;
  button.setAttribute("aria-label", wrapped ? "Disable wrap" : "Wrap long lines");
  button.title = wrapped ? "Disable wrap" : "Wrap long lines";
  button.setAttribute("aria-pressed", String(wrapped));
  button.innerHTML = iconMarkup(wrapped ? "text.alignleft" : "text.append");
}

async function copyCodeBlock(block: HTMLElement, withoutPrompts: boolean) {
  const raw = codeText(block);
  const text = withoutPrompts ? stripShellPrompts(raw) : raw;
  await navigator.clipboard.writeText(text);
  flashCodeCopied(block);
}

function flashCodeCopied(block: HTMLElement) {
  const button = block.querySelector<HTMLButtonElement>('[data-code-action="copy"]');
  if (!button) return;
  const token = String(Date.now());
  block.dataset.copyGeneration = token;
  button.dataset.copied = "true";
  button.setAttribute("aria-label", "Copied");
  button.title = "Copied";
  button.innerHTML = iconMarkup("checkmark");
  window.setTimeout(() => {
    if (block.dataset.copyGeneration !== token) return;
    button.dataset.copied = "false";
    button.setAttribute("aria-label", "Copy code");
    button.title = "Copy code";
    button.innerHTML = iconMarkup("doc.on.doc");
  }, 1200);
}

function codeText(block: HTMLElement): string {
  return block.querySelector("code")?.textContent ?? "";
}

function codeLanguage(block: HTMLElement): string {
  return block.dataset.codeLanguage ?? "";
}

function iconMarkup(symbol: string): string {
  const paths: Record<string, string> = {
    checkmark: '<path d="m5.5 12.4 4.1 4.1 8.9-9" />',
    "doc.on.doc":
      '<path d="M8.25 7.25h8.5v11.5h-8.5V7.25Z" /><path d="M5.25 15.75V4.25h8.5M5.25 4.25h8.5v3" />',
    "text.alignleft": '<path d="M5 7h14M5 11h10M5 15h14M5 19h8" />',
    "text.append":
      '<path d="M5 7h14M5 11h10M5 15h14M5 19h8" /><path d="m17 16.25 2.75 2.75L17 21.75" />',
  };
  return `<svg aria-hidden="true" class="mdv-symbol" data-sf-symbol="${symbol}" viewBox="0 0 24 24">${paths[symbol] ?? ""}</svg>`;
}

function Inspector() {
  const inspectorRef = useRef<HTMLElement | null>(null);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(
    () => localStorage.getItem("mdv.bookmarksExpanded") !== "false",
  );
  const [bookmarksHeight, setBookmarksHeight] = useState(() =>
    clampBookmarksHeight(readStoredNumber("mdv.bookmarksHeight", 180), 240),
  );
  const [tocSearchVisible, setTocSearchVisible] = useState(false);
  const [tocSearchQuery, setTocSearchQuery] = useState("");
  const activeTocHeadingId = useAppStore((state) => state.activeTocHeadingId);
  const inspectorVisible = useAppStore((state) => state.inspectorVisible);
  const toc = useAppStore((state) => state.toc);
  const bookmarks = useAppStore((state) => state.bookmarks);
  const filteredToc = useMemo(() => {
    const query = tocSearchQuery.trim().toLowerCase();
    if (!query) return toc;
    return toc.filter((heading) => heading.text.toLowerCase().includes(query));
  }, [toc, tocSearchQuery]);

  const maxBookmarksHeight = () => {
    const totalHeight = inspectorRef.current?.getBoundingClientRect().height ?? 240;
    return Math.max(120, totalHeight - 80 - 32 - 12);
  };

  const persistBookmarksHeight = (height: number) => {
    localStorage.setItem("mdv.bookmarksHeight", String(Math.round(height)));
  };

  const onResizePointerMove = (event: PointerEvent) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const nextHeight = clampBookmarksHeight(
      start.height - (event.clientY - start.y),
      maxBookmarksHeight(),
    );
    setBookmarksHeight(nextHeight);
    persistBookmarksHeight(nextHeight);
  };

  const stopResize = () => {
    if (!resizeStartRef.current) return;
    resizeStartRef.current = null;
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", stopResize);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = { y: event.clientY, height: bookmarksHeight };
    window.addEventListener("pointermove", onResizePointerMove);
    window.addEventListener("pointerup", stopResize);
  };

  return (
    <aside
      ref={inspectorRef}
      aria-label="Table of contents"
      aria-hidden={!inspectorVisible}
      className={`mdv-inspector-panel grid w-full grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden border-[var(--border)] border-t bg-[var(--panel)] lg:border-t-0 lg:border-l ${
        inspectorVisible ? "" : "pointer-events-none"
      }`}
      data-testid="inspector-panel"
    >
      <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-1.5">
          <PanelHeading>On This Page</PanelHeading>
          <button
            className="mdv-pane-icon-button"
            type="button"
            aria-label="Filter headings"
            onClick={() => setTocSearchVisible((visible) => !visible)}
          >
            <Icon name="magnifyingglass" />
          </button>
        </div>
        <div
          className="mdv-collapsible"
          data-open={tocSearchVisible ? "true" : "false"}
          data-testid="toc-search-pod"
        >
          <div className="px-2.5 pb-1.5">
            <label className="mdv-inspector-search">
              <Icon name="magnifyingglass" />
              <input
                data-testid="toc-filter"
                placeholder="Filter headings"
                value={tocSearchQuery}
                onChange={(event) => setTocSearchQuery(event.currentTarget.value)}
              />
              <button
                type="button"
                aria-label="Close heading filter"
                onClick={() => {
                  setTocSearchQuery("");
                  setTocSearchVisible(false);
                }}
              >
                <Icon name="xmark" />
              </button>
            </label>
          </div>
        </div>
        <nav className="min-h-0 overflow-auto px-2 py-1" data-testid="toc">
          <TocRows activeId={activeTocHeadingId} toc={filteredToc} />
        </nav>
      </div>
      <div
        className="mdv-inspector-resizer"
        data-testid="bookmarks-resizer"
        data-open={bookmarksExpanded ? "true" : "false"}
        onPointerDown={bookmarksExpanded ? startResize : undefined}
      />
      <div className="border-[var(--border)] border-t" data-testid="bookmarks">
        <button
          className="flex h-8 w-full items-center gap-1.5 px-3.5 py-2 text-left"
          type="button"
          aria-expanded={bookmarksExpanded}
          onClick={() =>
            setBookmarksExpanded((expanded) => {
              localStorage.setItem("mdv.bookmarksExpanded", String(!expanded));
              return !expanded;
            })
          }
        >
          <span className="grid w-2.5 place-items-center text-[var(--muted)]">
            <Icon name={bookmarksExpanded ? "chevronDown" : "chevronRight"} />
          </span>
          <PanelHeading>Bookmarks</PanelHeading>
          {bookmarks.length > 0 ? (
            <span className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--chrome-text)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] leading-none">
              {bookmarks.length}
            </span>
          ) : null}
        </button>
        <div
          className="mdv-collapsible"
          data-open={bookmarksExpanded ? "true" : "false"}
          data-testid="bookmarks-collapse"
        >
          <div
            className="mdv-bookmarks-content px-2 pb-3"
            data-testid="bookmarks-content"
            style={{ height: `${bookmarksHeight}px` }}
          >
            <BookmarkRows bookmarks={bookmarks} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function HistoryRows({ history }: { history: HistoryEntry[] }) {
  const navigateToDocument = useAppStore((state) => state.navigateToDocument);
  const revealPath = useAppStore((state) => state.revealPath);
  const removeHistoryEntry = useAppStore((state) => state.removeHistoryEntry);
  if (history.length === 0) return <Muted>No history yet.</Muted>;
  return history.map((entry) => (
    <DocumentRow
      key={entry.path}
      path={entry.path}
      title={entry.filename}
      subtitle={entry.path}
      subtitleMode="head"
      variant="history"
      revealLabel={`Reveal ${entry.filename} in Finder`}
      removeLabel="Remove from History"
      onReveal={() => void revealPath(entry.path)}
      onRemove={() => void removeHistoryEntry(entry.path)}
      onClick={() => void navigateToDocument(entry.path)}
    />
  ));
}

function SearchHits({ hits, query }: { hits: SearchHit[]; query: string }) {
  const navigateToDocument = useAppStore((state) => state.navigateToDocument);
  const revealPath = useAppStore((state) => state.revealPath);
  const setFindQuery = useAppStore((state) => state.setFindQuery);
  const openHit = async (hit: SearchHit) => {
    await navigateToDocument(hit.path);
    setFindQuery(query);
    window.dispatchEvent(new CustomEvent("mdv:open-find", { bubbles: false }));
  };
  return hits.map((hit) => (
    <DocumentRow
      key={hit.path}
      path={hit.path}
      title={hit.filename}
      subtitle={<HighlightedSnippet snippet={hit.snippet} />}
      variant="search"
      revealLabel={`Reveal ${hit.filename} in Finder`}
      onReveal={() => void revealPath(hit.path)}
      onClick={() => void openHit(hit)}
    />
  ));
}

function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts: Array<{ text: string; highlighted: boolean; key: number }> = [];
  let highlighted = false;
  let buffer = "";
  let key = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    parts.push({ text: buffer, highlighted, key: key++ });
    buffer = "";
  };
  for (const char of snippet) {
    if (char === "\u0002") {
      flush();
      highlighted = true;
    } else if (char === "\u0003") {
      flush();
      highlighted = false;
    } else {
      buffer += char;
    }
  }
  flush();

  return (
    <>
      {parts.map((part) =>
        part.highlighted ? (
          <strong className="mdv-snippet-match" key={part.key}>
            {part.text}
          </strong>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
    </>
  );
}

function clearInlineFindMarks(root: Element) {
  for (const mark of root.querySelectorAll("mark.mdv-inline-find-match")) {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
    parent?.normalize();
  }
}

function highlightInlineFindMatches(root: Element, query: string) {
  const needle = query.trim();
  if (!needle) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.toLowerCase().includes(needle.toLowerCase())) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    const text = node.textContent ?? "";
    const lower = text.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let index = lower.indexOf(lowerNeedle, cursor);
    while (index >= 0) {
      if (index > cursor) fragment.append(document.createTextNode(text.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = "mdv-inline-find-match";
      mark.textContent = text.slice(index, index + needle.length);
      fragment.append(mark);
      cursor = index + needle.length;
      index = lower.indexOf(lowerNeedle, cursor);
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
}

function BookmarkRows({ bookmarks }: { bookmarks: Bookmark[] }) {
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [overDragId, setOverDragId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ bookmarkId: number; x: number; y: number } | null>(null);
  const activeBookmarkId = useAppStore((state) => state.activeBookmarkId);
  const activeBlockIndex = useAppStore((state) => state.activeBlockIndex);
  const clearPlaceholder = useAppStore((state) => state.clearPlaceholder);
  const currentPath = useAppStore((state) => state.document?.path);
  const jumpToPlaceholder = useAppStore((state) => state.jumpToPlaceholder);
  const openBookmark = useAppStore((state) => state.openBookmark);
  const placeholder = useAppStore((state) => state.placeholder);
  const reorderBookmarks = useAppStore((state) => state.reorderBookmarks);
  const revealPath = useAppStore((state) => state.revealPath);
  const removeBookmark = useAppStore((state) => state.removeBookmark);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const bookmarkIds = useMemo(() => bookmarks.map((bookmark) => bookmark.id), [bookmarks]);
  const activeDragBookmark = bookmarks.find((bookmark) => bookmark.id === activeDragId) ?? null;
  const moveBookmark = (bookmarkId: number, destination: "up" | "down" | "top" | "bottom") => {
    const ids = bookmarks.map((bookmark) => bookmark.id);
    const index = ids.indexOf(bookmarkId);
    if (index < 0) return;
    const [id] = ids.splice(index, 1);
    const targetIndex =
      destination === "up"
        ? Math.max(0, index - 1)
        : destination === "down"
          ? Math.min(ids.length, index + 1)
          : destination === "top"
            ? 0
            : ids.length;
    ids.splice(targetIndex, 0, id);
    setMenu(null);
    void reorderBookmarks(ids);
  };
  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(Number(event.active.id));
  };
  const onDragOver = (event: DragOverEvent) => {
    const overId = Number(event.over?.id ?? event.collisions?.[0]?.id);
    setOverDragId(Number.isInteger(overId) ? overId : null);
  };
  const onDragMove = (event: DragMoveEvent) => {
    const overId = Number(event.over?.id ?? event.collisions?.[0]?.id);
    setOverDragId(Number.isInteger(overId) ? overId : null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    setOverDragId(null);
    const sourceId = Number(event.active.id);
    const targetId = Number(event.over?.id);
    if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId) {
      return;
    }
    const oldIndex = bookmarkIds.indexOf(sourceId);
    const newIndex = bookmarkIds.indexOf(targetId);
    if (oldIndex < 0 || newIndex < 0) return;
    void reorderBookmarks(arrayMove(bookmarkIds, oldIndex, newIndex));
  };
  if (bookmarks.length === 0 && !placeholder) {
    return (
      <div className="grid min-h-28 place-items-center px-2 py-5 text-center text-[var(--muted)]">
        <div className="grid justify-items-center gap-1.5">
          <span className="text-[color-mix(in_srgb,var(--muted)_46%,transparent)]">
            <Icon name="bookmark" />
          </span>
          <div className="text-[12px]">No bookmarks</div>
          <div className="text-[10px] text-[color-mix(in_srgb,var(--muted)_78%,transparent)]">
            Press <kbd className="mdv-keycap">⌘</kbd> <kbd className="mdv-keycap">D</kbd> at a spot
            in any file
          </div>
        </div>
      </div>
    );
  }
  const placeholderSelected =
    !!placeholder &&
    currentPath === placeholder.path &&
    activeBlockIndex === placeholder.blockIndex;
  return (
    <>
      {placeholder ? (
        <DocumentRow
          key="placeholder"
          path={placeholder.path}
          title={placeholder.title ?? "Placeholder"}
          subtitle={filenameForPath(placeholder.path)}
          variant="placeholder"
          iconName="pinFill"
          selected={placeholderSelected}
          removeLabel="Clear placeholder"
          onRemove={clearPlaceholder}
          onClick={() => void jumpToPlaceholder()}
        />
      ) : null}
      <DndContext
        collisionDetection={pointerWithin}
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragCancel={() => {
          setActiveDragId(null);
          setOverDragId(null);
        }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={bookmarkIds} strategy={verticalListSortingStrategy}>
          {bookmarks.map((bookmark) => (
            <SortableBookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              selected={activeBookmarkId === bookmark.id}
              showDropIndicator={overDragId === bookmark.id && activeDragId !== bookmark.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ bookmarkId: bookmark.id, x: event.clientX, y: event.clientY });
              }}
              onOpen={() => {
                if (bookmark.file_exists) void openBookmark(bookmark.id);
              }}
              onReveal={bookmark.file_exists ? () => void revealPath(bookmark.path) : undefined}
              onRemove={() => void removeBookmark(bookmark.id)}
            />
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeDragBookmark ? (
            <DocumentRow
              bookmarkId={activeDragBookmark.id}
              dragging
              iconName={activeDragBookmark.file_exists ? "bookmarkFill" : "docText"}
              muted={!activeDragBookmark.file_exists}
              path={activeDragBookmark.path}
              selected={activeBookmarkId === activeDragBookmark.id}
              subtitle={filenameForPath(activeDragBookmark.path)}
              title={activeDragBookmark.title}
              variant="bookmark"
              onClick={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {menu ? (
        <BookmarkContextMenu
          bookmarks={bookmarks}
          menu={menu}
          onClose={() => setMenu(null)}
          onMove={moveBookmark}
          onOpen={(bookmarkId) => {
            setMenu(null);
            void openBookmark(bookmarkId);
          }}
          onRemove={(bookmarkId) => {
            setMenu(null);
            void removeBookmark(bookmarkId);
          }}
          onReveal={(bookmark) => {
            setMenu(null);
            void revealPath(bookmark.path);
          }}
        />
      ) : null}
    </>
  );
}

function BookmarkContextMenu({
  bookmarks,
  menu,
  onClose,
  onMove,
  onOpen,
  onRemove,
  onReveal,
}: {
  bookmarks: Bookmark[];
  menu: { bookmarkId: number; x: number; y: number };
  onClose: () => void;
  onMove: (bookmarkId: number, destination: "up" | "down" | "top" | "bottom") => void;
  onOpen: (bookmarkId: number) => void;
  onRemove: (bookmarkId: number) => void;
  onReveal: (bookmark: Bookmark) => void;
}) {
  useEffect(() => {
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("keydown", onClose);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("keydown", onClose);
    };
  }, [onClose]);
  const index = bookmarks.findIndex((bookmark) => bookmark.id === menu.bookmarkId);
  const bookmark = bookmarks[index];
  const atTop = index <= 0;
  const atBottom = index < 0 || index >= bookmarks.length - 1;
  const left = Math.min(menu.x, window.innerWidth - 156);
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 248));
  return createPortal(
    <div
      className="fixed z-50 min-w-36 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-[12px] text-[var(--chrome-text)] shadow-lg"
      role="menu"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuButton disabled={!bookmark?.file_exists} onClick={() => onOpen(menu.bookmarkId)}>
        Go to Bookmark
      </MenuButton>
      <MenuButton disabled={!bookmark?.file_exists} onClick={() => bookmark && onReveal(bookmark)}>
        Reveal in Finder
      </MenuButton>
      <MenuDivider />
      <MenuButton disabled={atTop} onClick={() => onMove(menu.bookmarkId, "up")}>
        Move Up
      </MenuButton>
      <MenuButton disabled={atBottom} onClick={() => onMove(menu.bookmarkId, "down")}>
        Move Down
      </MenuButton>
      <MenuButton disabled={atTop} onClick={() => onMove(menu.bookmarkId, "top")}>
        Move to Top
      </MenuButton>
      <MenuButton disabled={atBottom} onClick={() => onMove(menu.bookmarkId, "bottom")}>
        Move to Bottom
      </MenuButton>
      <MenuDivider />
      <MenuButton onClick={() => onRemove(menu.bookmarkId)}>Remove Bookmark</MenuButton>
    </div>,
    document.body,
  );
}

function SortableBookmarkRow({
  bookmark,
  onContextMenu,
  onOpen,
  onRemove,
  onReveal,
  selected,
  showDropIndicator,
}: {
  bookmark: Bookmark;
  onContextMenu: (event: ReactMouseEvent<HTMLLIElement>) => void;
  onOpen: () => void;
  onRemove: () => void;
  onReveal?: () => void;
  selected: boolean;
  showDropIndicator: boolean;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform } = useSortable({
    id: bookmark.id,
    transition: {
      duration: 120,
      easing: "ease-out",
    },
  });
  const style: CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition: transform ? "transform 120ms ease-out" : undefined,
  };

  return (
    <DocumentRow
      bookmarkId={bookmark.id}
      dragging={isDragging}
      iconName={bookmark.file_exists ? "bookmarkFill" : "docText"}
      muted={!bookmark.file_exists}
      path={bookmark.path}
      refCallback={setNodeRef}
      rowAttributes={attributes}
      rowListeners={listeners}
      rowStyle={style}
      selected={selected}
      showDropIndicator={showDropIndicator}
      subtitle={filenameForPath(bookmark.path)}
      title={bookmark.title}
      variant="bookmark"
      revealLabel={`Reveal bookmark ${bookmark.title} in Finder`}
      removeLabel={`Remove bookmark ${bookmark.title}`}
      onContextMenu={onContextMenu}
      onReveal={onReveal}
      onRemove={onRemove}
      onClick={onOpen}
    />
  );
}

function MenuButton({
  ariaLabel,
  children,
  disabled,
  onClick,
}: {
  ariaLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="block w-full px-3 py-1.5 text-left disabled:text-[color-mix(in_srgb,var(--muted)_55%,transparent)] enabled:hover:bg-[var(--panel-strong)]"
      aria-label={ariaLabel}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return <hr className="my-1 border-[var(--border)] border-t" />;
}

function TocRows({ activeId, toc }: { activeId: string | null; toc: TocHeading[] }) {
  const currentPath = useAppStore((state) => state.document?.path);
  const navigateToDocument = useAppStore((state) => state.navigateToDocument);
  const setActiveTocHeadingId = useAppStore((state) => state.setActiveTocHeadingId);
  if (toc.length === 0) {
    return (
      <div className="grid min-h-36 place-items-center text-center text-[var(--muted)]">
        <div className="grid justify-items-center gap-2">
          <span className="mdv-empty-icon">
            <Icon name="listBulletIndent" />
          </span>
          <span className="text-[12px]">No headings</span>
        </div>
      </div>
    );
  }
  return toc.map((heading) => (
    <button
      key={heading.id}
      className={`mdv-toc-row rounded-[5px] text-left hover:bg-[var(--panel-strong)] ${
        activeId === heading.id ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : ""
      }`}
      aria-current={activeId === heading.id ? "location" : undefined}
      style={{ paddingLeft: `${8 + Math.max(0, heading.level - 1) * 12}px` }}
      type="button"
      onClick={() => {
        setActiveTocHeadingId(heading.id);
        if (currentPath) {
          void navigateToDocument(currentPath, { fragment: heading.id });
        }
      }}
    >
      {heading.text}
    </button>
  ));
}

function DocumentRow({
  bookmarkId,
  dragging = false,
  iconName = "docText",
  muted = false,
  onClick,
  onContextMenu,
  onReveal,
  onRemove,
  refCallback,
  revealLabel,
  removeLabel,
  path,
  rowAttributes,
  rowListeners,
  rowStyle,
  selected: selectedOverride,
  showDropIndicator = false,
  subtitle,
  subtitleMode = "tail",
  title,
  variant = "history",
}: {
  bookmarkId?: number;
  dragging?: boolean;
  iconName?: IconName;
  muted?: boolean;
  onClick: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLLIElement>) => void;
  onReveal?: () => void;
  onRemove?: () => void;
  refCallback?: (node: HTMLLIElement | null) => void;
  revealLabel?: string;
  removeLabel?: string;
  path: string;
  rowAttributes?: DraggableAttributes;
  rowListeners?: SyntheticListenerMap;
  rowStyle?: CSSProperties;
  selected?: boolean;
  showDropIndicator?: boolean;
  subtitle: ReactNode;
  subtitleMode?: "head" | "tail";
  title: string;
  variant?: "history" | "search" | "bookmark" | "placeholder";
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const currentPath = useAppStore((state) => state.document?.path);
  const selected = selectedOverride ?? currentPath === path;
  const hasContextMenu = Boolean(onReveal || onRemove || variant === "search");

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  return (
    <>
      <li
        ref={refCallback}
        className={`mdv-document-row group grid list-none grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-[5px] px-2 ${
          selected
            ? "bg-[color-mix(in_srgb,var(--chrome-text)_12%,transparent)]"
            : "hover:bg-[var(--panel-strong)]"
        } ${muted ? "opacity-60" : ""} ${dragging ? "opacity-55 ring-1 ring-[var(--accent)]" : ""} ${
          showDropIndicator ? "mdv-document-row-drop-target" : ""
        }`}
        data-bookmark-id={bookmarkId}
        data-dragging={dragging ? "true" : "false"}
        data-drop-target={showDropIndicator ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-row-variant={variant}
        draggable={false}
        style={rowStyle}
        onContextMenu={(event) => {
          if (onContextMenu) {
            onContextMenu(event);
            return;
          }
          if (!hasContextMenu) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <span className="mdv-row-icon">
          <Icon name={iconName} />
        </span>
        <button
          className="grid min-w-0 gap-px py-1 text-left"
          type="button"
          onClick={onClick}
          {...rowAttributes}
          {...rowListeners}
        >
          <span className="truncate text-[13px] text-[var(--chrome-text)] leading-[16px]">
            {title}
          </span>
          <span
            className={`truncate text-[var(--muted)] leading-[13px] ${
              variant === "bookmark" ? "text-[10px]" : "text-[11px]"
            } ${subtitleMode === "head" ? "mdv-truncate-head" : ""}`}
          >
            {subtitle}
          </span>
        </button>
      </li>
      {menu ? (
        <DocumentRowContextMenu
          left={Math.min(menu.x, window.innerWidth - 168)}
          top={Math.max(8, Math.min(menu.y, window.innerHeight - 132))}
          onClick={variant === "search" ? onClick : undefined}
          onClose={() => setMenu(null)}
          onRemove={onRemove}
          onReveal={onReveal}
          removeLabel={removeLabel}
          revealLabel={revealLabel}
        />
      ) : null}
    </>
  );
}

function DocumentRowContextMenu({
  left,
  onClick,
  onClose,
  onRemove,
  onReveal,
  removeLabel,
  revealLabel,
  top,
}: {
  left: number;
  onClick?: () => void;
  onClose: () => void;
  onRemove?: () => void;
  onReveal?: () => void;
  removeLabel?: string;
  revealLabel?: string;
  top: number;
}) {
  const run = (action: () => void) => {
    onClose();
    action();
  };
  return createPortal(
    <div
      className="fixed z-50 min-w-40 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-[12px] text-[var(--chrome-text)] shadow-lg"
      role="menu"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {onClick ? <MenuButton onClick={() => run(onClick)}>Open</MenuButton> : null}
      {onReveal ? (
        <MenuButton ariaLabel={revealLabel} onClick={() => run(onReveal)}>
          Reveal in Finder
        </MenuButton>
      ) : null}
      {onRemove ? (
        <>
          <MenuDivider />
          <MenuButton onClick={() => run(onRemove)}>{removeLabel ?? "Remove"}</MenuButton>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 font-semibold text-[11px] text-[var(--muted)] uppercase tracking-[0.6px]">
      {children}
    </h2>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <div className="p-2 text-[var(--muted)] text-sm">{children}</div>;
}

function Icon({ name }: { name: IconName }) {
  const sfSymbols: Record<IconName, string> = {
    bookmark: "bookmark",
    bookmarkFill: "bookmark.fill",
    chevronDown: "chevron.down",
    chevronLeft: "chevron.left",
    chevronRight: "chevron.right",
    chevronUp: "chevron.up",
    checkmark: "checkmark",
    docOnDoc: "doc.on.doc",
    docText: "doc.text",
    listBulletIndent: "list.bullet.indent",
    magnifyingglass: "magnifyingglass",
    paintpalette: "paintpalette",
    pencil: "pencil",
    pinFill: "pin.fill",
    plus: "plus",
    sidebarRight: "sidebar.right",
    textAlignleft: "text.alignleft",
    textAppend: "text.append",
    trash: "trash",
    xmark: "xmark",
  };
  const paths: Record<IconName, ReactNode> = {
    bookmark: <path d="M6.75 4.25h10.5v16.5L12 17.25l-5.25 3.5V4.25Z" />,
    bookmarkFill: (
      <path d="M6.75 4.25h10.5v16.5L12 17.25l-5.25 3.5V4.25Z" fill="currentColor" stroke="none" />
    ),
    chevronDown: <path d="m6.75 9.25 5.25 5.5 5.25-5.5" />,
    chevronLeft: <path d="m14.75 6.75-5.5 5.25 5.5 5.25" />,
    chevronRight: <path d="m9.25 6.75 5.5 5.25-5.5 5.25" />,
    chevronUp: <path d="m6.75 14.75 5.25-5.5 5.25 5.5" />,
    checkmark: <path d="m5.5 12.4 4.1 4.1 8.9-9" />,
    docOnDoc: (
      <>
        <path d="M8.25 7.25h8.5v11.5h-8.5V7.25Z" />
        <path d="M5.25 15.75V4.25h8.5M5.25 4.25h8.5v3" />
      </>
    ),
    docText: (
      <>
        <path d="M7 3.75h6.25L17 7.5v12.75H7V3.75Z" />
        <path d="M13.25 3.75V7.5H17M9.25 11h5.5M9.25 14h5.5M9.25 17h3.75" />
      </>
    ),
    listBulletIndent: (
      <>
        <path d="M5.5 7h.01M5.5 12h.01M5.5 17h.01" />
        <path d="M9 7h9.5M12 12h6.5M12 17h6.5" />
      </>
    ),
    magnifyingglass: <path d="m16.75 16.75 3 3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />,
    paintpalette: (
      <>
        <path d="M12 4a8 8 0 0 0-8 8c0 3.4 2.1 6.25 5.05 7.4.9.35 1.65-.35 1.65-1.22 0-.62.5-1.13 1.12-1.13h1.25A6.95 6.95 0 0 0 20 10.1C20 6.72 16.42 4 12 4Z" />
        <path d="M7.9 11.2h.1M9.7 8.1h.1M13.1 7.35h.1M16.1 9.55h.1" />
      </>
    ),
    pencil: (
      <>
        <path d="M4.75 17.25 4 20l2.75-.75L18.6 7.4a1.75 1.75 0 0 0 0-2.48l-.52-.52a1.75 1.75 0 0 0-2.48 0L4.75 17.25Z" />
        <path d="m14.5 5.5 4 4" />
      </>
    ),
    pinFill: (
      <path
        d="M13.75 3.75 20.25 10.25 17.5 11.25 14.2 14.55 14.75 19.75 13.5 21 10 15.55 4.55 12.05 5.8 10.8 11 11.35 14.3 8.05 13.75 3.75Z"
        fill="currentColor"
        stroke="none"
      />
    ),
    plus: <path d="M12 5.25v13.5M5.25 12h13.5" />,
    sidebarRight: (
      <>
        <path d="M4.75 5.25h14.5v13.5H4.75V5.25Z" />
        <path d="M14.25 5.25v13.5" />
      </>
    ),
    textAlignleft: <path d="M5 7h14M5 11h10M5 15h14M5 19h8" />,
    textAppend: (
      <>
        <path d="M5 7h14M5 11h10M5 15h14M5 19h8" />
        <path d="m17 16.25 2.75 2.75L17 21.75" />
      </>
    ),
    trash: (
      <>
        <path d="M5.5 7h13M9 7V5h6v2M8 9.25l.6 10h6.8l.6-10" />
        <path d="M10.5 11.25v5.5M13.5 11.25v5.5" />
      </>
    ),
    xmark: <path d="m7 7 10 10M17 7 7 17" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="mdv-symbol"
      data-sf-symbol={sfSymbols[name]}
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function isRemoteUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function remoteHostLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function documentPlaceholder(label: string, state = "missing"): HTMLSpanElement {
  const placeholder = document.createElement("span");
  placeholder.className = "mdv-image-placeholder";
  placeholder.dataset.imageState = state;
  placeholder.textContent = label;
  return placeholder;
}

function filenameForPath(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function readStoredNumber(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function clampBookmarksHeight(height: number, maxHeight: number): number {
  return Math.max(120, Math.min(Math.max(120, maxHeight), Math.round(height)));
}

function topVisibleBlockIndex(scroller: HTMLElement): number {
  const blocks = Array.from(scroller.querySelectorAll<HTMLElement>("[data-mdv-block-index]"));
  if (blocks.length === 0) return 0;

  const threshold = scroller.getBoundingClientRect().top + 24;
  let active = blocks[0];
  for (const block of blocks) {
    if (block.getBoundingClientRect().top > threshold) break;
    active = block;
  }
  return Number(active.dataset.mdvBlockIndex ?? 0);
}

function topVisibleHeadingId(scroller: HTMLElement): string | null {
  const headings = Array.from(
    scroller.querySelectorAll<HTMLElement>(
      ".markdown-body h1[id], .markdown-body h2[id], .markdown-body h3[id], .markdown-body h4[id], .markdown-body h5[id], .markdown-body h6[id]",
    ),
  );
  if (headings.length === 0) return null;

  const scrollerTop = scroller.getBoundingClientRect().top;
  const threshold = scrollerTop + 24;
  let active = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > threshold) break;
    active = heading;
  }
  return active.id;
}
