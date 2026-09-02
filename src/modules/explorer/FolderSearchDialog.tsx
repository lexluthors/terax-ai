import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { GrepHit, GrepResponse } from "@/modules/ai/lib/native";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupByFile } from "./lib/folderSearch";
import { fileIconUrl } from "./lib/iconResolver";

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;
const MAX_RESULTS = 500;

type Props = {
  open: boolean;
  folder: string;
  displayPath: string;
  onOpenChange: (open: boolean) => void;
  onOpenHit: (path: string, line: number) => void;
};

export function FolderSearchDialog({
  open,
  folder,
  displayPath,
  onOpenChange,
  onOpenHit,
}: Props) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<GrepHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastFolder = useRef<string | null>(null);

  // Reopening the same folder restores the previous query and results
  // instantly (this component stays mounted while the dialog is closed),
  // while the search effect below refreshes them in the background. A
  // different folder starts fresh.
  useEffect(() => {
    if (!open) return;
    if (lastFolder.current !== folder) {
      lastFolder.current = folder;
      setQuery("");
      setCaseSensitive(false);
      setHits([]);
      setTruncated(false);
      setSearching(false);
    }
    setSelectedIndex(0);
    inputRef.current?.focus();
  }, [open, folder]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setHits([]);
      setSearching(false);
      setTruncated(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await invoke<GrepResponse>("fs_grep", {
          pattern: q,
          root: folder,
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
  }, [open, query, caseSensitive, folder]);

  const groups = useMemo(() => groupByFile(hits), [hits]);

  useEffect(() => {
    if (groups.length > 0) {
      const el = scrollRef.current?.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, groups]);

  const handleSelect = (index: number) => {
    const group = groups[index];
    if (!group) return;
    onOpenHit(group.path, group.firstLine);
    onOpenChange(false);
  };

  const ready = query.trim().length >= MIN_QUERY_LEN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon icon={Search01Icon} size={16} className="shrink-0" />
            <span className="shrink-0">Search in Folder</span>
            {displayPath ? (
              <span
                className="min-w-0 truncate font-mono text-xs font-normal text-muted-foreground"
                title={displayPath}
              >
                {displayPath}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

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
                e.stopPropagation();
                onOpenChange(false);
                return;
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
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  handleSelect(selectedIndex);
                }
              }
            }}
            placeholder="Search file contents…"
            className="h-8 pr-14 pl-7 text-xs"
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

        <div className="max-h-80 min-h-32 overflow-y-auto">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
