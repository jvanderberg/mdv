import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "./store";
import type { Bookmark, HistoryEntry, SearchHit, TocHeading } from "./types";

export function App() {
  const theme = useAppStore((state) => state.theme);
  const zoom = useAppStore((state) => state.zoom);
  const api = useAppStore((state) => state.api);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateForward = useAppStore((state) => state.navigateForward);
  const openFirstPath = useAppStore((state) => state.openFirstPath);
  const refreshLists = useAppStore((state) => state.refreshLists);

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

  return (
    <main className="grid h-screen overflow-hidden grid-rows-[auto_minmax(0,1fr)] bg-[var(--bg)] text-[var(--chrome-text)]">
      <TopBar />
      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_240px]">
        <Sidebar />
        <Viewer />
        <Inspector />
      </div>
    </main>
  );
}

function TopBar() {
  const chooseAndOpenDirectory = useAppStore((state) => state.chooseAndOpenDirectory);
  const chooseAndOpenDocument = useAppStore((state) => state.chooseAndOpenDocument);
  const cycleTheme = useAppStore((state) => state.cycleTheme);
  const document = useAppStore((state) => state.document);
  const findQuery = useAppStore((state) => state.findQuery);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateForward = useAppStore((state) => state.navigateForward);
  const setFindQuery = useAppStore((state) => state.setFindQuery);
  const addBookmarkAtCurrentSpot = useAppStore((state) => state.addBookmarkAtCurrentSpot);
  const toggleInspector = useAppStore((state) => state.toggleInspector);
  const zoomIn = useAppStore((state) => state.zoomIn);
  const zoomOut = useAppStore((state) => state.zoomOut);

  return (
    <header className="grid min-h-12 min-w-0 grid-cols-1 items-center gap-2 border-[var(--border)] border-b bg-[var(--titlebar)] px-4 py-2 md:grid-cols-[auto_minmax(120px,1fr)_auto] md:gap-4 md:py-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="h-3.5 w-3.5 rounded-full bg-[#d7d7d7]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#d7d7d7]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#d7d7d7]" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-bold text-[#777] text-base">
            {document?.filename ?? "mdv"}
          </div>
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-[auto_auto_minmax(120px,1fr)] items-center gap-1.5 xl:mx-auto xl:max-w-[460px]">
        <button
          className="mdv-icon-button"
          type="button"
          aria-label="Back"
          disabled={!document}
          onClick={() => void navigateBack()}
        >
          &lt;
        </button>
        <button
          className="mdv-icon-button"
          type="button"
          aria-label="Forward"
          disabled={!document}
          onClick={() => void navigateForward()}
        >
          &gt;
        </button>
        <input
          className="mdv-input"
          placeholder="Find"
          value={findQuery}
          onChange={(event) => setFindQuery(event.currentTarget.value)}
        />
      </div>

      <div
        className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end md:gap-3"
        data-testid="app-toolbar"
      >
        <button
          className="mdv-icon-button text-2xl"
          type="button"
          aria-label="Open"
          onClick={() => void chooseAndOpenDocument()}
        >
          +
        </button>
        <button
          className="mdv-icon-button text-xl"
          type="button"
          aria-label="Folder"
          onClick={() => void chooseAndOpenDirectory()}
        >
          /
        </button>
        <button
          className="mdv-icon-button text-xl"
          type="button"
          aria-label="Theme"
          onClick={cycleTheme}
        >
          ◉
        </button>
        <button className="mdv-icon-button" type="button" aria-label="Zoom out" onClick={zoomOut}>
          -
        </button>
        <button className="mdv-icon-button" type="button" aria-label="Zoom in" onClick={zoomIn}>
          +
        </button>
        <button
          className="mdv-icon-button text-2xl"
          type="button"
          aria-label="Bookmark"
          disabled={!document}
          onClick={() => void addBookmarkAtCurrentSpot()}
        >
          ♡
        </button>
        <button
          className="mdv-icon-button text-xl"
          type="button"
          aria-label="Table of contents"
          onClick={toggleInspector}
        >
          ▣
        </button>
      </div>
    </header>
  );
}

function Sidebar() {
  const searchHistory = useAppStore((state) => state.searchHistory);
  const clearHistory = useAppStore((state) => state.clearHistory);
  const globalHits = useAppStore((state) => state.globalHits);
  const history = useAppStore((state) => state.history);

  return (
    <aside
      aria-label="History"
      className="max-h-[260px] overflow-auto border-[var(--border)] border-b bg-[var(--panel)] lg:max-h-none lg:border-r lg:border-b-0"
    >
      <div className="grid gap-5 px-3 pt-8 pb-3 text-[var(--muted)] text-xs uppercase">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="history-search">History</label>
          <button
            className="rounded px-1.5 py-0.5 text-[10px] normal-case hover:bg-[var(--panel-strong)]"
            type="button"
            onClick={() => void clearHistory()}
          >
            Clear
          </button>
        </div>
        <input
          id="history-search"
          className="mdv-input sr-only"
          placeholder="Search history"
          onChange={(event) => void searchHistory(event.currentTarget.value)}
        />
      </div>

      <div className="grid gap-0.5 p-2" data-testid="history-list">
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
  const scrollRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const document = useAppStore((state) => state.document);
  const findMatches = useAppStore((state) => state.findMatches);
  const currentFragment = useAppStore((state) => state.currentFragment);
  const html = useAppStore((state) => state.html);
  const pendingScrollTop = useAppStore((state) => state.pendingScrollTop);
  const consumePendingScrollTop = useAppStore((state) => state.consumePendingScrollTop);
  const api = useAppStore((state) => state.api);
  const navigateToHref = useAppStore((state) => state.navigateToHref);
  const saveScrollPosition = useAppStore((state) => state.saveScrollPosition);
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

  const handleScroll = (event: React.UIEvent<HTMLElement>) => {
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    const scrollTop = event.currentTarget.scrollTop;
    saveTimerRef.current = window.setTimeout(() => {
      void saveScrollPosition(scrollTop);
    }, 80);
  };

  return (
    <section
      ref={scrollRef}
      className="min-w-0 overflow-auto bg-[var(--bg)]"
      data-testid="viewer-scroll"
      onScroll={handleScroll}
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
  const [tocSearchVisible, setTocSearchVisible] = useState(false);
  const [tocSearchQuery, setTocSearchQuery] = useState("");
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
      className="w-full overflow-auto border-[var(--border)] border-t bg-[var(--panel)] p-4 lg:w-[240px] lg:border-t-0 lg:border-l"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <PanelHeading>On This Page</PanelHeading>
        <button
          className="mdv-icon-button"
          type="button"
          aria-label="Filter headings"
          onClick={() => setTocSearchVisible((visible) => !visible)}
        >
          ⌕
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
        <TocRows toc={filteredToc} />
      </nav>
      <PanelHeading>Bookmarks</PanelHeading>
      <div className="grid gap-0.5" data-testid="bookmarks">
        <BookmarkRows bookmarks={bookmarks} />
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

function TocRows({ toc }: { toc: TocHeading[] }) {
  if (toc.length === 0) return <Muted>No headings.</Muted>;
  return toc.map((heading) => (
    <button
      key={heading.id}
      className="rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--panel-strong)]"
      style={{ paddingLeft: `${10 + Math.max(0, heading.level - 1) * 12}px` }}
      type="button"
      onClick={() => document.getElementById(heading.id)?.scrollIntoView({ block: "start" })}
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
  subtitle,
  title,
}: {
  muted?: boolean;
  onClick: () => void;
  onReveal?: () => void;
  onRemove?: () => void;
  revealLabel?: string;
  removeLabel?: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div
      className={`group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded-md hover:bg-[var(--panel-strong)] ${
        muted ? "opacity-55" : ""
      }`}
    >
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
          x
        </button>
      ) : null}
    </div>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 font-semibold text-[var(--muted)] text-xs uppercase">{children}</h2>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="p-2 text-[var(--muted)] text-sm">{children}</div>;
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
