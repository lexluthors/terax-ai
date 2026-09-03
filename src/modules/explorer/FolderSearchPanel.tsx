import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GrepHit, GrepResponse } from "@/modules/ai/lib/native";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  Cancel01Icon,
  ChevronDownIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { groupByFile } from "./lib/folderSearch";
import { fileIconUrl } from "./lib/iconResolver";

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;
const MAX_RESULTS = 500;

// Search history management
const HISTORY_KEY = "folder-search-history";
const QUERY_HISTORY_KEY = "folder-search-query-history";
const MAX_HISTORY = 20;

type SearchHistoryItem = {
  path: string;
  lastUsed: number;
};

type QueryHistoryItem = {
  query: string;
  lastUsed: number;
};

function loadSearchHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SearchHistoryItem[];
  } catch {
    return [];
  }
}

function saveSearchHistory(history: SearchHistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function addToHistory(path: string): SearchHistoryItem[] {
  const history = loadSearchHistory();
  const existing = history.findIndex((h) => h.path === path);
  if (existing >= 0) {
    history[existing].lastUsed = Date.now();
  } else {
    history.push({ path, lastUsed: Date.now() });
  }
  // Sort by lastUsed descending and limit
  const sorted = history
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_HISTORY);
  saveSearchHistory(sorted);
  return sorted;
}

function getLastUsedPath(): string | null {
  const history = loadSearchHistory();
  return history.length > 0 ? history[0].path : null;
}

// Query history management
function loadQueryHistory(): QueryHistoryItem[] {
  try {
    const raw = localStorage.getItem(QUERY_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueryHistoryItem[];
  } catch {
    return [];
  }
}

function saveQueryHistory(history: QueryHistoryItem[]): void {
  try {
    localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function addToQueryHistory(query: string): QueryHistoryItem[] {
  const trimmed = query.trim();
  if (!trimmed) return loadQueryHistory();
  const history = loadQueryHistory();
  const existing = history.findIndex((h) => h.query === trimmed);
  if (existing >= 0) {
    history[existing].lastUsed = Date.now();
  } else {
    history.push({ query: trimmed, lastUsed: Date.now() });
  }
  const sorted = history
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_HISTORY);
  saveQueryHistory(sorted);
  return sorted;
}

type Props = {
  rootPath: string | null;
  initialFolder: string | null;
  onOpenHit: (path: string, line: number) => void;
};

export function FolderSearchPanel({
  rootPath,
  initialFolder,
  onOpenHit,
}: Props) {
  const [folderPath, setFolderPath] = useState<string>(
    initialFolder ?? getLastUsedPath() ?? rootPath ?? "",
  );
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<GrepHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SearchHistoryItem[]>(loadSearchHistory);
  const [showQueryHistory, setShowQueryHistory] = useState(false);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>(loadQueryHistory);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const queryHistoryRef = useRef<HTMLDivElement>(null);

  // Update folder when initialFolder changes (from right-click)
  useEffect(() => {
    if (initialFolder) {
      setFolderPath(initialFolder);
      setHistory(loadSearchHistory());
    }
  }, [initialFolder]);

  // Close history dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
      if (queryHistoryRef.current && !queryHistoryRef.current.contains(e.target as Node)) {
        setShowQueryHistory(false);
      }
    };
    if (showHistory || showQueryHistory) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showHistory, showQueryHistory]);

  // Search effect
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN || !folderPath) {
      setHits([]);
      setSearching(false);
      setTruncated(false);
      return;
    }
    // Save query to history
    addToQueryHistory(q);
    setQueryHistory(loadQueryHistory());
    setSearching(true);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await invoke<GrepResponse>("fs_grep", {
          pattern: q,
          root: folderPath,
          literal: true,
          caseInsensitive: !caseSensitive,
          maxResults: MAX_RESULTS,
          workspace: currentWorkspaceEnv(),
        });
        if (alive) {
          setHits(res.hits);
          setTruncated(res.truncated);
          setSelectedIndex(0);
        }
      } catch (e) {
        if (alive) {
          console.error("fs_grep failed:", e);
          setHits([]);
          setTruncated(false);
        }
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, caseSensitive, folderPath]);

  const groups = useMemo(() => groupByFile(hits), [hits]);

  useEffect(() => {
    if (groups.length > 0) {
      const el = scrollRef.current?.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, groups]);

  const handleSelect = useCallback(
    (index: number) => {
      const group = groups[index];
      if (!group) return;
      onOpenHit(group.path, group.firstLine);
    },
    [groups, onOpenHit],
  );

  const handleFolderChange = useCallback((path: string) => {
    setFolderPath(path);
    addToHistory(path);
    setHistory(loadSearchHistory());
    setShowHistory(false);
  }, []);

  const getDisplayPath = useCallback(
    (path: string) => {
      if (!rootPath) return path;
      if (path === rootPath) return path.split("/").pop() || path;
      const rel = path.startsWith(rootPath)
        ? path.slice(rootPath.length + 1)
        : path;
      return rel || path.split("/").pop() || path;
    },
    [rootPath],
  );

  const ready = query.trim().length >= MIN_QUERY_LEN;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={14}
          className="shrink-0 text-muted-foreground"
        />
        <span className="flex-1 truncate text-xs font-medium text-foreground/80">
          Search
        </span>
      </div>

      {/* Folder path selector */}
      <div className="relative shrink-0 border-b border-border/40 p-2" ref={historyRef}>
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="flex w-full items-center gap-1 rounded bg-muted/50 px-2 py-1 text-left text-xs hover:bg-muted"
          title={folderPath}
        >
          <span className="min-w-0 flex-1 truncate">{getDisplayPath(folderPath)}</span>
          <HugeiconsIcon
            icon={ChevronDownIcon}
            size={12}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              showHistory && "rotate-180",
            )}
          />
        </button>

        {/* History dropdown */}
        {showHistory && (
          <div className="absolute left-2 right-2 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {history.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No search history
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => handleFolderChange(item.path)}
                  className={cn(
                    "flex w-full items-center px-2 py-1 text-left text-xs hover:bg-accent",
                    item.path === folderPath && "bg-accent",
                  )}
                  title={item.path}
                >
                  <span className="min-w-0 truncate">{getDisplayPath(item.path)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Search input */}
      <div className="relative shrink-0 border-b border-border/40 p-2" ref={queryHistoryRef}>
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={2}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setShowQueryHistory(false);
                setQuery("");
                return;
              }
              if (e.key === "Enter" && groups.length > 0) {
                e.preventDefault();
                setShowQueryHistory(false);
                handleSelect(selectedIndex);
                return;
              }
              if (showQueryHistory && queryHistory.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  return;
                }
              }
              if (groups.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex((prev) => (prev + 1) % groups.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex(
                    (prev) => (prev - 1 + groups.length) % groups.length,
                  );
                }
              }
            }}
            placeholder="Search file contents…"
            className="h-7 pr-14 pl-7 text-xs"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-9 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowQueryHistory(!showQueryHistory)}
            className={cn(
              "absolute top-1/2 right-16 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
              showQueryHistory && "bg-accent text-foreground",
            )}
            aria-label="Search history"
            title="Search history"
          >
            <HugeiconsIcon
              icon={ChevronDownIcon}
              size={11}
              className={cn("transition-transform", showQueryHistory && "rotate-180")}
            />
          </button>
          <button
            type="button"
            aria-pressed={caseSensitive}
            aria-label="Match case"
            title="Match case"
            onClick={() => setCaseSensitive((v) => !v)}
            className={cn(
              "absolute top-1/2 right-2 -translate-y-1/2 rounded px-1 py-0.5 text-[11px] font-semibold",
              caseSensitive
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            Aa
          </button>
        </div>

        {/* Query history dropdown */}
        {showQueryHistory && (
          <div className="absolute left-2 right-2 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {queryHistory.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No search history
              </div>
            ) : (
              queryHistory.map((item) => (
                <button
                  key={item.query}
                  type="button"
                  onClick={() => {
                    setQuery(item.query);
                    setShowQueryHistory(false);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "flex w-full items-center px-2 py-1 text-left text-xs hover:bg-accent",
                    item.query === query && "bg-accent",
                  )}
                  title={item.query}
                >
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={11}
                    className="mr-1.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 truncate">{item.query}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1" ref={scrollRef}>
          {!ready ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              Type at least {MIN_QUERY_LEN} characters to search.
            </div>
          ) : searching && groups.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              Searching…
            </div>
          ) : groups.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              No matches
            </div>
          ) : (
            groups.map((group, index) => {
              const url = fileIconUrl(group.name);
              return (
                <button
                  key={group.path}
                  type="button"
                  data-index={index}
                  onClick={() => handleSelect(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-foreground"
                      : "hover:bg-accent/50 text-foreground/80",
                  )}
                  title={group.path}
                >
                  <img src={url} alt="" className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{group.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {group.count}
                  </span>
                  <span className="ml-auto max-w-[50%] truncate text-[10px] text-muted-foreground">
                    {group.rel}
                  </span>
                </button>
              );
            })
          )}
          {truncated && groups.length > 0 ? (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
              Showing partial results. Refine your query.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
