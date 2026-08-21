import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "./store";
import type { Bookmark, HistoryEntry, SearchHit, TocHeading } from "./types";

type IconName =
  | "bookmark"
  | "bookmarkFill"
  | "chevronDown"
  | "chevronRight"
  | "chevronUp"
  | "docText"
  | "magnifyingglass"
  | "paintpalette"
  | "pencil"
  | "plus"
  | "sidebarRight"
  | "trash"
  | "xmark";

export function App() {
  const theme = useAppStore((state) => state.theme);
  const zoom = useAppStore((state) => state.zoom);
  const api = useAppStore((state) => state.api);
  const addBookmarkAtCurrentSpot = useAppStore((state) => state.addBookmarkAtCurrentSpot);
  const chooseAndOpenDocument = useAppStore((state) => state.chooseAndOpenDocument);
  const chooseEditor = useAppStore((state) => state.chooseEditor);
  const editCurrentFile = useAppStore((state) => state.editCurrentFile);
  const forgetEditor = useAppStore((state) => state.forgetEditor);
  const jumpToPlaceholder = useAppStore((state) => state.jumpToPlaceholder);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateForward = useAppStore((state) => state.navigateForward);
  const openFirstPath = useAppStore((state) => state.openFirstPath);
  const refreshLists = useAppStore((state) => state.refreshLists);
  const resetZoom = useAppStore((state) => state.resetZoom);
  const setTheme = useAppStore((state) => state.setTheme);
  const setPlaceholder = useAppStore((state) => state.setPlaceholder);
  const sidebarVisible = useAppStore((state) => state.sidebarVisible);
  const toggleInspector = useAppStore((state) => state.toggleInspector);
  const toggleLoadRemoteImages = useAppStore((state) => state.toggleLoadRemoteImages);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const toggleSmartTypography = useAppStore((state) => state.toggleSmartTypography);
  const zoomIn = useAppStore((state) => state.zoomIn);
  const zoomOut = useAppStore((state) => state.zoomOut);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--zoom", String(zoom));
  }, [theme, zoom]);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void api
      .subscribeToFileDrops(async (paths) => {
        await openFirstPath(paths);
      })
      .then((nextUnsubscribe) => {
        if (cancelled) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, openFirstPath]);

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

    void api.takePendingOpenPaths().then((paths) => openFirstPath(paths));
    void api
      .subscribeToOpenRequests(async (paths) => {
        await openFirstPath(paths);
      })
      .then((nextUnsubscribe) => {
        if (cancelled) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, openFirstPath]);

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
          case "open-new-window":
            await chooseAndOpenDocument();
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
            setTheme("paper");
            break;
          case "theme-charcoal":
            setTheme("charcoal");
            break;
          case "theme-solarized":
            setTheme("solarized");
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
    <main className="grid h-screen overflow-hidden grid-rows-[auto_minmax(0,1fr)] bg-[var(--bg)] text-[var(--chrome-text)]">
      <TopBar />
      <div
        className={`grid min-h-0 grid-cols-1 ${
          sidebarVisible
            ? "lg:grid-cols-[240px_minmax(0,1fr)_240px]"
            : "lg:grid-cols-[minmax(0,1fr)_240px]"
        }`}
      >
        {sidebarVisible ? <Sidebar /> : null}
        <Viewer />
        <Inspector />
      </div>
    </main>
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
    <header className="grid h-12 min-w-0 grid-cols-[minmax(110px,1fr)_auto] items-center overflow-hidden border-[var(--border)] border-b bg-[var(--titlebar)] pr-3 pl-5">
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

function ThemeMenu({
  onSelect,
  selected,
}: {
  onSelect: (theme: "paper" | "charcoal" | "solarized") => void;
  selected: "paper" | "charcoal" | "solarized";
}) {
  const [open, setOpen] = useState(false);
  const themes = [
    ["paper", "High Contrast"],
    ["charcoal", "Charcoal"],
    ["solarized", "Solarium Daylight"],
  ] as const;

  return (
    <div className="relative">
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
          className="absolute top-9 right-0 z-20 min-w-44 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-lg"
          role="menu"
        >
          {themes.map(([id, label]) => (
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
              <span aria-hidden="true">{selected === id ? "*" : ""}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Sidebar() {
  const [searchVisible, setSearchVisible] = useState(false);
  const searchHistory = useAppStore((state) => state.searchHistory);
  const clearHistory = useAppStore((state) => state.clearHistory);
  const globalHits = useAppStore((state) => state.globalHits);
  const history = useAppStore((state) => state.history);

  useEffect(() => {
    const onFocusHistorySearch = () => setSearchVisible(true);
    window.addEventListener("mdv:focus-history-search", onFocusHistorySearch);
    return () => window.removeEventListener("mdv:focus-history-search", onFocusHistorySearch);
  }, []);

  return (
    <aside
      aria-label="History"
      className="max-h-[260px] overflow-auto border-[var(--border)] border-b bg-[var(--panel)] lg:max-h-none lg:border-r lg:border-b-0"
    >
      <div className="grid gap-2 px-3 pt-8 pb-2 text-[var(--muted)] text-xs uppercase">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="history-search">History</label>
          <button
            className="mdv-pane-icon-button"
            type="button"
            aria-label="Search history"
            onClick={() => setSearchVisible((visible) => !visible)}
          >
            <Icon name="magnifyingglass" />
          </button>
        </div>
        {searchVisible ? (
          <div className="grid gap-1.5">
            <input
              id="history-search"
              className="mdv-input mdv-pane-input"
              placeholder="Search history"
              onChange={(event) => void searchHistory(event.currentTarget.value)}
            />
            <button
              className="justify-self-start rounded px-1 py-0.5 text-[10px] normal-case hover:bg-[var(--panel-strong)]"
              type="button"
              onClick={() => void clearHistory()}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-0.5 p-2 pt-1" data-testid="history-list">
        {globalHits.length > 0 ? (
          <SearchHits hits={globalHits} />
        ) : (
          <HistoryRows history={history} />
        )}
      </div>
    </aside>
  );
}

function Viewer() {
  const [findVisible, setFindVisible] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);
  const ignoreScrollUntilRef = useRef(0);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const document = useAppStore((state) => state.document);
  const findQuery = useAppStore((state) => state.findQuery);
  const findMatches = useAppStore((state) => state.findMatches);
  const currentFindMatchIndex = useAppStore((state) => state.currentFindMatchIndex);
  const currentFragment = useAppStore((state) => state.currentFragment);
  const html = useAppStore((state) => state.html);
  const pendingScrollTop = useAppStore((state) => state.pendingScrollTop);
  const consumePendingScrollTop = useAppStore((state) => state.consumePendingScrollTop);
  const api = useAppStore((state) => state.api);
  const navigateToHref = useAppStore((state) => state.navigateToHref);
  const nextFindMatch = useAppStore((state) => state.nextFindMatch);
  const previousFindMatch = useAppStore((state) => state.previousFindMatch);
  const saveScrollPosition = useAppStore((state) => state.saveScrollPosition);
  const setActiveTocHeadingId = useAppStore((state) => state.setActiveTocHeadingId);
  const setFindQuery = useAppStore((state) => state.setFindQuery);
  const setViewerScrollTop = useAppStore((state) => state.setViewerScrollTop);
  const handleMarkdownLink = (target: EventTarget | null): boolean => {
    const anchor = (target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return false;
    void navigateToHref(anchor.getAttribute("href") ?? "");
    return true;
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
    if (!document || !scrollRef.current) return;
    const images = Array.from(
      scrollRef.current.querySelectorAll<HTMLImageElement>("img[data-mdv-local-image]"),
    );
    for (const image of images) {
      const src = image.dataset.mdvLocalImage;
      if (!src) continue;
      void api.resolveLocalImage(document.path, src).then((resolved) => {
        const currentImages = Array.from(
          scrollRef.current?.querySelectorAll<HTMLImageElement>("img[data-mdv-local-image]") ?? [],
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
      });
    }
  }, [api, document, html]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
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
      setFindVisible(true);
      window.requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLInputElement>("[data-testid='document-find']")
          ?.focus();
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      setViewerScrollTop(element.scrollTop);
      setActiveTocHeadingId(topVisibleHeadingId(element));
      scheduleScrollSave(element.scrollTop);
    };
    element.addEventListener("scroll", onScroll);
    onScroll();
    return () => element.removeEventListener("scroll", onScroll);
  }, [html, setActiveTocHeadingId, setViewerScrollTop]);

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
    >
      <article
        className="markdown-body relative mx-auto max-w-[760px] px-6 py-10 md:px-11 md:py-12"
        data-current-fragment={currentFragment ?? undefined}
        data-testid="markdown-body"
        onClick={(event) => {
          if (handleMarkdownLink(event.target)) event.preventDefault();
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
            <div dangerouslySetInnerHTML={{ __html: html }} />
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

function Inspector() {
  const [bookmarksExpanded, setBookmarksExpanded] = useState(
    () => localStorage.getItem("mdv.bookmarksExpanded") !== "false",
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

  if (!inspectorVisible) return null;

  return (
    <aside
      aria-label="Table of contents"
      className="grid w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden border-[var(--border)] border-t bg-[var(--panel)] lg:w-[240px] lg:border-t-0 lg:border-l"
    >
      <div className="min-h-0 overflow-auto p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
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
        {tocSearchVisible ? (
          <input
            className="mdv-input mb-3"
            data-testid="toc-filter"
            placeholder="Filter headings"
            value={tocSearchQuery}
            onChange={(event) => setTocSearchQuery(event.currentTarget.value)}
          />
        ) : null}
        <nav className="mb-5 grid gap-0.5" data-testid="toc">
          <TocRows activeId={activeTocHeadingId} toc={filteredToc} />
        </nav>
      </div>
      <div className="border-[var(--border)] border-t p-4" data-testid="bookmarks">
        <button
          className="mb-0 flex w-full items-center gap-2 text-left"
          type="button"
          aria-expanded={bookmarksExpanded}
          onClick={() =>
            setBookmarksExpanded((expanded) => {
              localStorage.setItem("mdv.bookmarksExpanded", String(!expanded));
              return !expanded;
            })
          }
        >
          <Icon name={bookmarksExpanded ? "chevronDown" : "chevronRight"} />
          <PanelHeading>Bookmarks</PanelHeading>
        </button>
        {bookmarksExpanded ? (
          <div className="mt-3 grid gap-0.5">
            <BookmarkRows bookmarks={bookmarks} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function HistoryRows({ history }: { history: HistoryEntry[] }) {
  const openDocument = useAppStore((state) => state.openDocument);
  const revealPath = useAppStore((state) => state.revealPath);
  const removeHistoryEntry = useAppStore((state) => state.removeHistoryEntry);
  if (history.length === 0) return <Muted>No history yet.</Muted>;
  return history.map((entry) => (
    <DocumentRow
      key={entry.path}
      path={entry.path}
      title={entry.filename}
      subtitle={entry.path}
      revealLabel={`Reveal ${entry.filename} in Finder`}
      removeLabel={`Remove ${entry.filename} from history`}
      onReveal={() => void revealPath(entry.path)}
      onRemove={() => void removeHistoryEntry(entry.path)}
      onClick={() => void openDocument(entry.path)}
    />
  ));
}

function SearchHits({ hits }: { hits: SearchHit[] }) {
  const openDocument = useAppStore((state) => state.openDocument);
  const revealPath = useAppStore((state) => state.revealPath);
  return hits.map((hit) => (
    <DocumentRow
      key={hit.path}
      path={hit.path}
      title={hit.filename}
      subtitle={hit.snippet}
      revealLabel={`Reveal ${hit.filename} in Finder`}
      onReveal={() => void revealPath(hit.path)}
      onClick={() => void openDocument(hit.path)}
    />
  ));
}

function BookmarkRows({ bookmarks }: { bookmarks: Bookmark[] }) {
  const openDocument = useAppStore((state) => state.openDocument);
  const revealPath = useAppStore((state) => state.revealPath);
  const removeBookmark = useAppStore((state) => state.removeBookmark);
  if (bookmarks.length === 0) return <Muted>No bookmarks.</Muted>;
  return bookmarks.map((bookmark) => (
    <DocumentRow
      key={bookmark.id}
      path={bookmark.path}
      title={bookmark.title}
      subtitle={bookmark.path}
      muted={!bookmark.file_exists}
      revealLabel={`Reveal bookmark ${bookmark.title} in Finder`}
      removeLabel={`Remove bookmark ${bookmark.title}`}
      onReveal={() => void revealPath(bookmark.path)}
      onRemove={() => void removeBookmark(bookmark.id)}
      onClick={() => void openDocument(bookmark.path)}
    />
  ));
}

function TocRows({ activeId, toc }: { activeId: string | null; toc: TocHeading[] }) {
  const setActiveTocHeadingId = useAppStore((state) => state.setActiveTocHeadingId);
  if (toc.length === 0) return <Muted>No headings.</Muted>;
  return toc.map((heading) => (
    <button
      key={heading.id}
      className={`rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--panel-strong)] ${
        activeId === heading.id ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : ""
      }`}
      aria-current={activeId === heading.id ? "location" : undefined}
      style={{ paddingLeft: `${10 + Math.max(0, heading.level - 1) * 12}px` }}
      type="button"
      onClick={() => {
        setActiveTocHeadingId(heading.id);
        document.getElementById(heading.id)?.scrollIntoView({ block: "start" });
      }}
    >
      {heading.text}
    </button>
  ));
}

function DocumentRow({
  muted = false,
  onClick,
  onReveal,
  onRemove,
  revealLabel,
  removeLabel,
  path,
  subtitle,
  title,
}: {
  muted?: boolean;
  onClick: () => void;
  onReveal?: () => void;
  onRemove?: () => void;
  revealLabel?: string;
  removeLabel?: string;
  path: string;
  subtitle: string;
  title: string;
}) {
  const currentPath = useAppStore((state) => state.document?.path);
  const selected = currentPath === path;
  return (
    <div
      className={`group grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1 rounded-md ${
        selected
          ? "bg-[color-mix(in_srgb,var(--chrome-text)_12%,transparent)]"
          : "hover:bg-[var(--panel-strong)]"
      } ${muted ? "opacity-55" : ""}`}
    >
      <Icon name="docText" />
      <button
        className="grid min-w-0 gap-0.5 px-2.5 py-2 text-left"
        type="button"
        onClick={onClick}
      >
        <strong className="text-[var(--chrome-text)]">{title}</strong>
        <span className="truncate text-[var(--muted)] text-xs">{subtitle}</span>
      </button>
      {onReveal ? (
        <button
          aria-label={revealLabel}
          className="mr-1 rounded px-2 py-1 text-[var(--muted)] text-xs opacity-0 hover:bg-[var(--bg)] hover:text-[var(--text)] group-hover:opacity-100"
          type="button"
          onClick={onReveal}
        >
          Reveal
        </button>
      ) : null}
      {onRemove ? (
        <button
          aria-label={removeLabel}
          className="mr-1 rounded px-2 py-1 text-[var(--muted)] opacity-0 hover:bg-[var(--bg)] hover:text-[var(--text)] group-hover:opacity-100"
          type="button"
          onClick={onRemove}
        >
          <Icon name="xmark" />
        </button>
      ) : null}
    </div>
  );
}

function PanelHeading({ children }: { children: ReactNode }) {
  return <h2 className="m-0 font-semibold text-[var(--muted)] text-xs uppercase">{children}</h2>;
}

function Muted({ children }: { children: ReactNode }) {
  return <div className="p-2 text-[var(--muted)] text-sm">{children}</div>;
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    bookmark: <path d="M6.75 4.25h10.5v16.5L12 17.25l-5.25 3.5V4.25Z" />,
    bookmarkFill: <path d="M6.75 4.25h10.5v16.5L12 17.25l-5.25 3.5V4.25Z" fill="currentColor" />,
    chevronDown: <path d="m6.75 9.25 5.25 5.5 5.25-5.5" />,
    chevronRight: <path d="m9.25 6.75 5.5 5.25-5.5 5.25" />,
    chevronUp: <path d="m6.75 14.75 5.25-5.5 5.25 5.5" />,
    docText: (
      <>
        <path d="M7 3.75h6.25L17 7.5v12.75H7V3.75Z" />
        <path d="M13.25 3.75V7.5H17M9.25 11h5.5M9.25 14h5.5M9.25 17h3.75" />
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
    plus: <path d="M12 5v14M5 12h14" />,
    sidebarRight: (
      <>
        <path d="M4.75 5.25h14.5v13.5H4.75V5.25Z" />
        <path d="M14.25 5.25v13.5" />
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
    <svg aria-hidden="true" className="mdv-symbol" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

function documentPlaceholder(label: string): HTMLSpanElement {
  const placeholder = document.createElement("span");
  placeholder.className = "mdv-image-placeholder";
  placeholder.dataset.imageState = "missing";
  placeholder.textContent = label;
  return placeholder;
}

function filenameForPath(path: string): string {
  return path.split("/").at(-1) ?? path;
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
