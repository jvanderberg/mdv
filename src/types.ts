export interface HistoryEntry {
  path: string;
  filename: string;
  added_at: number;
}

export interface Bookmark {
  id: number;
  path: string;
  title: string;
  sort_order: number;
  created_at: number;
  block_index: number;
  block_fingerprint: string;
  file_exists: boolean;
}

export interface LoadedDocument {
  path: string;
  filename: string;
  content: string;
  file_mtime_ms: number;
  file_size: number;
}

export interface FileSignature {
  path: string;
  file_mtime_ms: number;
  file_size: number;
}

export interface ScrollPosition {
  path: string;
  block_index: number;
  block_fingerprint: string;
  scroll_top: number;
}

export interface SearchHit {
  path: string;
  filename: string;
  snippet: string;
}

export interface ResolvedLocalImage {
  path: string;
  exists: boolean;
}

export interface NativeMenuState {
  hasDocument: boolean;
  hasEditor: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  sidebarVisible: boolean;
  smartTypography: boolean;
  smartTypographyAllowed: boolean;
  loadRemoteImages: boolean;
  bookmarkSlots: Array<{ title: string; enabled: boolean }>;
}

export interface TocHeading {
  id: string;
  level: number;
  text: string;
  blockIndex: number;
}

declare global {
  interface Window {
    __MDV_TEST_API__?: import("./tauri").MdvApi;
    __MDV_CLI_INSTALL_CALLS__?: string[];
    __MDV_CLIPBOARD__?: string;
    __MDV_CLIPBOARD_HTML__?: string;
    __MDV_CLIPBOARD_TYPES__?: string[];
    __MDV_BOOKMARKS__?: Bookmark[];
    __MDV_HISTORY__?: HistoryEntry[];
    __MDV_DROP_PATHS__?: (paths: string[]) => Promise<void>;
    __MDV_OPEN_PATHS__?: (paths: string[]) => Promise<void>;
    __MDV_PENDING_OPEN_PATHS__?: string[];
    __MDV_REWRITE_DOCUMENT__?: (path: string, content: string) => void;
    __MDV_EDITOR_CALLS__?: Array<{ editorPath: string; documentPath: string }>;
    __MDV_EXTERNAL_CALLS__?: string[];
    __MDV_MENU_COMMAND__?: (command: string) => Promise<void>;
    __MDV_OPEN_DOCUMENT__?: (path: string) => Promise<void>;
    __MDV_OPEN_NEW_WINDOW_CALLS__?: string[];
    __MDV_REVEAL_CALLS__?: string[];
    __MDV_RESOLVE_BOOKMARK__?: (blocks: string[], index: number, fingerprint: string) => number;
    __MDV_SCROLL_POSITIONS__?: Record<string, ScrollPosition>;
    __MDV_NATIVE_MENU_STATES__?: NativeMenuState[];
    __MDV_SHARED_STATE_CHANGED__?: () => Promise<void>;
    __MDV_SHARED_STATE_SUBSCRIBED__?: boolean;
  }
}
