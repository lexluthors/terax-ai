import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useGlobalShortcuts } from "@/modules/shortcuts";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  DocumentCodeIcon,
  FileAddIcon,
  Folder01Icon,
  FolderAddIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { CommitDialog } from "./CommitDialog";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";
import { FolderSearchDialog } from "./FolderSearchDialog";
import { InlineInput } from "./InlineInput";
import {
  copyFilesToClipboard,
  copyToClipboard,
  executeFile,
  isExecutableFile,
  openSystemTerminal,
  pasteFilesFromClipboard,
  pruneDescendantPaths,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { gitCurrentBranch, isGitRepo } from "./lib/gitOperations";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { useExplorerDnd } from "./lib/useExplorerDnd";
import { useExplorerFileDrop } from "./lib/useExplorerFileDrop";
import { useFileTree } from "./lib/useFileTree";
import { useGitStatus } from "./lib/useGitStatus";
import { PullPushDialog } from "./PullPushDialog";
import { EntryRow, PendingRow, type RowActions, StatusRow } from "./TreeRow";

export type FileExplorerHandle = {
  focus: () => void;
  isFocused: () => boolean;
  focusSearch: () => void;
};

type Props = {
  rootPath: string | null;
  activeFilePath?: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onOpenContentHit?: (path: string, line: number) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  pathDropTarget?: TerminalPathDropTarget;
  gitStatus?: GitStatusSnapshot | null;
  // Search panel callbacks
  onToggleSearchPanel?: (open: boolean) => void;
  onSearchInFolder?: (folderPath: string) => void;
  searchPanelOpen?: boolean;
};

type Row =
  | {
      kind: "entry";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      isExpanded: boolean;
      depth: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | { kind: "pending"; key: string; depth: number; pendingKind: "file" | "dir" }
  | {
      kind: "status";
      key: string;
      depth: number;
      tone: "muted" | "error";
      message: string;
    };

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function parentOf(path: string, fallback: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : fallback;
}

function buildRows(
  rootPath: string,
  tree: ReturnType<typeof useFileTree>,
  lookup: (path: string) => GitStatusCode | null,
): { rows: Row[]; entryIndexByPath: Map<string, number> } {
  const rows: Row[] = [];
  const entryIndexByPath = new Map<string, number>();

  const walk = (parent: string, depth: number, parentIgnored: boolean) => {
    const node = tree.nodes[parent];
    if (!node || node.status !== "loaded") return;
    for (const entry of node.entries) {
      const path = tree.joinPath(parent, entry.name);
      const isDir = entry.kind === "dir";
      const expanded = isDir && tree.expanded.has(path);
      const isRenaming = tree.renaming === path;
      const gitignored = parentIgnored || entry.gitignored;
      const gitStatusCode = gitignored ? null : lookup(path);
      if (isRenaming) {
        rows.push({
          kind: "rename",
          key: `rename:${path}`,
          path,
          name: entry.name,
          isDir,
          depth,
          gitignored,
          gitStatusCode,
        });
      } else {
        entryIndexByPath.set(path, rows.length);
        rows.push({
          kind: "entry",
          key: path,
          path,
          name: entry.name,
          isDir,
          isExpanded: expanded,
          depth,
          gitignored,
          gitStatusCode,
        });
      }
      if (isDir && expanded) {
        const child = tree.nodes[path];
        if (tree.pendingCreate?.parentPath === path) {
          rows.push({
            kind: "pending",
            key: `pending:${path}`,
            depth: depth + 1,
            pendingKind: tree.pendingCreate.kind,
          });
        }
        if (child?.status === "loading") {
          rows.push({
            kind: "status",
            key: `loading:${path}`,
            depth: depth + 1,
            tone: "muted",
            message: "Loading…",
          });
        } else if (child?.status === "error") {
          rows.push({
            kind: "status",
            key: `error:${path}`,
            depth: depth + 1,
            tone: "error",
            message: child.message,
          });
        } else if (child?.status === "loaded") {
          walk(path, depth + 1, gitignored);
        }
      }
    }
  };

  walk(rootPath, 0, false);
  return { rows, entryIndexByPath };
}

export const FileExplorer = memo(
  forwardRef<FileExplorerHandle, Props>(function FileExplorer(
    {
      rootPath,
      activeFilePath,
      onOpenFile,
      onOpenContentHit,
      onPathRenamed,
      onPathDeleted,
      onRevealInTerminal,
      onAttachToAgent,
      pathDropTarget,
      gitStatus,
      onToggleSearchPanel,
      onSearchInFolder,
      searchPanelOpen,
    },
    ref,
  ) {
    const tree = useFileTree(rootPath, { onPathRenamed, onPathDeleted });
    const gitDecorations = usePreferencesStore((s) => s.explorerGitDecorations);
    const { lookup: lookupGitStatus } = useGitStatus(
      rootPath,
      gitDecorations ? gitStatus : null,
      gitDecorations,
    );
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [lastClickedPath, setLastClickedPath] = useState<string | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const searchRef = useRef<ExplorerSearchHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const { rows, entryIndexByPath } = useMemo(() => {
      if (!rootPath)
        return {
          rows: [] as Row[],
          entryIndexByPath: new Map<string, number>(),
        };
      return buildRows(rootPath, tree, lookupGitStatus);
      // `tree` is intentionally omitted: its identity changes every render, but
      // the listed fields are the only inputs buildRows actually reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      rootPath,
      tree.nodes,
      tree.expanded,
      tree.renaming,
      tree.pendingCreate,
      lookupGitStatus,
    ]);

    const rowActions = useMemo<RowActions>(
      () => ({
        toggle: tree.toggle,
        beginRename: tree.beginRename,
        commitRename: tree.commitRename,
        cancelRename: tree.cancelRename,
      }),
      [tree.toggle, tree.beginRename, tree.commitRename, tree.cancelRename],
    );
    const renameInProgress =
      tree.renaming !== null || tree.pendingCreate !== null;

    const [menuTarget, setMenuTarget] = useState<{
      path: string;
      name: string;
      isDir: boolean;
    } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    // Bumped on every right-click so the menu content remounts and the popper
    // re-anchors to the new cursor (floating-ui won't reposition on an anchor
    // change alone, only on scroll/resize).
    const [menuNonce, setMenuNonce] = useState(0);

    // Git 对话框状态
    const [gitRepoPath, setGitRepoPath] = useState<string | null>(null);
    const [gitBranch, setGitBranch] = useState<string>("HEAD");
    const [showPullDialog, setShowPullDialog] = useState(false);
    const [showPushDialog, setShowPushDialog] = useState(false);
    const [showCommitDialog, setShowCommitDialog] = useState(false);

    // 文件夹内容搜索弹窗状态
    const [searchFolder, setSearchFolder] = useState<string | null>(null);

    // Git 检查完成后重新渲染菜单
    useEffect(() => {
      if (menuTarget) {
        setMenuNonce((n) => n + 1);
      }
    }, [gitRepoPath, gitBranch, menuTarget]);

    // 检查是否为 git 仓库
    const checkGitRepo = useCallback(async (path: string, isDir: boolean) => {
      const targetPath = isDir
        ? path
        : path.substring(0, path.lastIndexOf("/"));
      if (!targetPath) return;
      const isRepo = await isGitRepo(targetPath);
      if (isRepo) {
        setGitRepoPath(targetPath);
        const branch = await gitCurrentBranch(targetPath);
        setGitBranch(branch);
      } else {
        setGitRepoPath(null);
      }
    }, []);

    const entryPaths = useMemo<string[]>(() => {
      const out: string[] = [];
      for (const row of rows) if (row.kind === "entry") out.push(row.path);
      return out;
    }, [rows]);

    const handleSelectPath = useCallback(
      (path: string, event?: React.MouseEvent) => {
        const ctrlKey = event?.ctrlKey || event?.metaKey;
        const shiftKey = event?.shiftKey;

        if (shiftKey && lastClickedPath) {
          // Shift+click: 选中连续范围
          const startIdx = entryPaths.indexOf(lastClickedPath);
          const endIdx = entryPaths.indexOf(path);
          if (startIdx >= 0 && endIdx >= 0) {
            const [min, max] = [
              Math.min(startIdx, endIdx),
              Math.max(startIdx, endIdx),
            ];
            const rangePaths = entryPaths.slice(min, max + 1);
            setSelectedPaths(new Set(rangePaths));
            setSelectedPath(path);
          }
        } else if (ctrlKey) {
          // Ctrl+click: 切换单个文件的选中状态
          const newSelected = new Set(selectedPaths);
          if (newSelected.has(path)) {
            newSelected.delete(path);
            if (selectedPath === path) {
              setSelectedPath(
                newSelected.size > 0 ? Array.from(newSelected)[0] : null,
              );
            }
          } else {
            newSelected.add(path);
            setSelectedPath(path);
          }
          setSelectedPaths(newSelected);
        } else {
          // 普通点击: 清空多选，只选中当前
          setSelectedPaths(new Set([path]));
          setSelectedPath(path);
        }
        setLastClickedPath(path);
      },
      [entryPaths, lastClickedPath, selectedPath, selectedPaths],
    );

    const isDirAt = useCallback(
      (path: string): boolean | undefined => {
        const idx = entryIndexByPath.get(path);
        const row = idx !== undefined ? rows[idx] : undefined;
        return row?.kind === "entry" ? row.isDir : undefined;
      },
      [entryIndexByPath, rows],
    );
    const dnd = useExplorerDnd({
      rootPath: rootPath ?? "",
      isDir: isDirAt,
      onMove: tree.movePath,
      pathDropTarget,
    });

    const fileDrop = useExplorerFileDrop({
      rootPath,
      isDir: isDirAt,
      onCopied: tree.refresh,
    });

    const dropTargetDir = dnd.dropTargetDir ?? fileDrop.externalTargetDir;
    const rootIsDropTarget =
      dropTargetDir != null && dropTargetDir === rootPath;
    useEffect(() => {
      if (!dropTargetDir || dropTargetDir === rootPath) return;
      if (tree.expanded.has(dropTargetDir)) return;
      const id = window.setTimeout(() => tree.expand(dropTargetDir), 700);
      return () => window.clearTimeout(id);
    }, [dropTargetDir, rootPath, tree.expanded, tree.expand]);

    useEffect(() => {
      if (selectedPath && !entryIndexByPath.has(selectedPath)) {
        setSelectedPath(null);
        setSelectedPaths(new Set());
      }
    }, [entryIndexByPath, selectedPath]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      getItemKey: (index) => rows[index]?.key ?? index,
    });

    const scrollEntryIntoView = useCallback(
      (path: string) => {
        const index = entryIndexByPath.get(path);
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
      [entryIndexByPath, virtualizer],
    );

    const lastSyncedActivePathRef = useRef<string | null>(null);
    useEffect(() => {
      if (
        !activeFilePath ||
        !rootPath ||
        activeFilePath === lastSyncedActivePathRef.current
      ) {
        return;
      }
      // If the file is not yet visible, expand ancestor directories so it
      // becomes visible. We read tree.expanded without listing it as a dep
      // because entryIndexByPath already re-computes whenever it changes.
      if (!entryIndexByPath.has(activeFilePath)) {
        let needsExpansion = false;
        let cursor = parentOf(activeFilePath, rootPath);
        while (cursor && cursor !== rootPath) {
          if (!tree.expanded.has(cursor)) {
            tree.expand(cursor);
            needsExpansion = true;
          }
          cursor = parentOf(cursor, rootPath);
        }
        if (needsExpansion) return;
        // Ancestors already expanded but file still absent (parent still
        // loading); wait for the next entryIndexByPath update.
        return;
      }
      lastSyncedActivePathRef.current = activeFilePath;
      setSelectedPath(activeFilePath);
      setSelectedPaths(new Set([activeFilePath]));
      requestAnimationFrame(() => scrollEntryIntoView(activeFilePath));
    }, [
      activeFilePath,
      rootPath,
      entryIndexByPath,
      scrollEntryIntoView,
      tree.expand,
      tree.expanded,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          containerRef.current?.focus();
          if (!selectedPath && entryPaths.length > 0) {
            const first = entryPaths[0];
            setSelectedPath(first);
            setSelectedPaths(new Set([first]));
            requestAnimationFrame(() => scrollEntryIntoView(first));
          }
        },
        isFocused: () => {
          const c = containerRef.current;
          if (!c) return false;
          const active = document.activeElement;
          return active instanceof Node && c.contains(active);
        },
        focusSearch: () => {
          setIsSearchOpen(true);
          searchRef.current?.focus();
        },
      }),
      [entryPaths, scrollEntryIntoView, selectedPath],
    );

    useGlobalShortcuts({
      "explorer.search": () => {
        if (searchRef.current?.isFocused()) {
          setIsSearchOpen(false);
          return;
        }
        setIsSearchOpen(true);
        searchRef.current?.focus();
      },
    });

    if (!rootPath) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={24}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <div className="text-xs text-muted-foreground">
            No current directory
          </div>
        </div>
      );
    }

    const root = tree.nodes[rootPath];
    const pendingAtRoot =
      tree.pendingCreate?.parentPath === rootPath ? tree.pendingCreate : null;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (entryPaths.length === 0) return;

      const currentIdx = selectedPath ? entryPaths.indexOf(selectedPath) : -1;
      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(entryPaths.length - 1, next));
        const path = entryPaths[clamped];
        setSelectedPath(path);
        setSelectedPaths(new Set([path]));
        requestAnimationFrame(() => scrollEntryIntoView(path));
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(currentIdx < 0 ? 0 : currentIdx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(currentIdx < 0 ? entryPaths.length - 1 : currentIdx - 1);
          break;
        case "ArrowRight": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) {
            if (!row.isExpanded) tree.toggle(row.path);
            else move(currentIdx + 1);
          }
          break;
        }
        case "ArrowLeft": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir && row.isExpanded) {
            tree.toggle(row.path);
          } else {
            const parent = row.path.slice(0, row.path.lastIndexOf("/"));
            if (parent && parent !== rootPath) {
              setSelectedPath(parent);
              setSelectedPaths(new Set([parent]));
            }
          }
          break;
        }
        case "Enter": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) tree.toggle(row.path);
          else onOpenFile(row.path);
          break;
        }
      }
    };

    const renderRow = (row: Row) => {
      switch (row.kind) {
        case "entry":
        case "rename": {
          return (
            <EntryRow
              path={row.path}
              name={row.name}
              isDir={row.isDir}
              isExpanded={row.kind === "entry" ? row.isExpanded : false}
              depth={row.depth}
              actions={rowActions}
              renameInProgress={renameInProgress}
              isSelected={selectedPath === row.path}
              isMultiSelected={selectedPaths.has(row.path)}
              isRenaming={row.kind === "rename"}
              isDropTarget={dropTargetDir === row.path}
              onOpenFile={onOpenFile}
              onSelectPath={handleSelectPath}
              gitStatusCode={row.gitStatusCode}
              gitignored={gitDecorations && row.gitignored}
            />
          );
        }
        case "pending":
          return (
            <PendingRow
              depth={row.depth}
              kind={row.pendingKind}
              onCommit={tree.commitCreate}
              onCancel={tree.cancelCreate}
            />
          );
        case "status":
          return (
            <StatusRow
              depth={row.depth}
              message={row.message}
              tone={row.tone}
            />
          );
      }
    };

    return (
      <div
        ref={containerRef}
        className="flex h-full flex-col outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <span
            className="flex flex-1 items-center truncate text-xs font-medium text-foreground/80"
            title={rootPath}
          >
            <img
              src={folderIconUrl(basename(rootPath), false)}
              alt=""
              height={15}
              width={15}
              className="mx-1.5"
            />
            {basename(rootPath)}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearchOpen((v) => !v)}
            title="Search files"
            aria-label="Search files"
          >
            <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={2} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.beginCreate(rootPath, "file")}
            title="New file"
          >
            <HugeiconsIcon icon={FileAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.beginCreate(rootPath, "dir")}
            title="New folder"
          >
            <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.refresh(rootPath)}
            title="Refresh"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 text-muted-foreground hover:text-foreground",
              searchPanelOpen && "bg-accent text-foreground",
            )}
            onClick={() => onToggleSearchPanel?.(!searchPanelOpen)}
            title="Toggle search panel"
          >
            <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={2} />
          </Button>
        </div>

        <ExplorerSearch
          ref={searchRef}
          rootPath={rootPath}
          onOpenFile={onOpenFile}
          open={isSearchOpen}
          onRequestClose={() => setIsSearchOpen(false)}
          onActiveChange={setIsSearchActive}
          onRevealInTerminal={onRevealInTerminal}
          onAttachToAgent={onAttachToAgent}
        />

        {!isSearchActive ? (
          <ContextMenu
            onOpenChange={(open) => {
              if (!open) setDeleteConfirm(false);
            }}
          >
            <ContextMenuTrigger asChild>
              <div
                ref={scrollRef}
                data-explorer-drop=""
                className={cn(
                  "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
                  rootIsDropTarget &&
                    "rounded-sm ring-1 ring-inset ring-primary/50",
                )}
                onPointerDown={dnd.onPointerDown}
                onClickCapture={dnd.onClickCapture}
                onContextMenuCapture={(e) => {
                  const el = (e.target as HTMLElement).closest<HTMLElement>(
                    "[data-fs-path]",
                  );
                  const path = el?.getAttribute("data-fs-path") ?? null;
                  const idx =
                    path != null ? entryIndexByPath.get(path) : undefined;
                  const row = idx !== undefined ? rows[idx] : undefined;
                  const target =
                    row && row.kind === "entry"
                      ? { path: row.path, name: row.name, isDir: row.isDir }
                      : null;
                  setMenuTarget(target);
                  setDeleteConfirm(false);
                  setMenuNonce((n) => n + 1);
                  // 检查是否为 git 仓库（异步，不阻塞菜单显示）
                  if (target) {
                    void checkGitRepo(target.path, target.isDir);
                  } else {
                    void checkGitRepo(rootPath, true);
                  }
                }}
              >
                {pendingAtRoot ? (
                  <div
                    className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
                    style={{ paddingLeft: 6 }}
                  >
                    <span className="size-3.5 shrink-0" />
                    <img
                      src={
                        pendingAtRoot.kind === "dir"
                          ? folderIconUrl("", false)
                          : fileIconUrl("untitled")
                      }
                      alt=""
                      className="size-4 shrink-0 opacity-70"
                    />
                    <InlineInput
                      initial=""
                      placeholder={
                        pendingAtRoot.kind === "dir" ? "New folder" : "New file"
                      }
                      onCommit={tree.commitCreate}
                      onCancel={tree.cancelCreate}
                    />
                  </div>
                ) : null}
                {root?.status === "loading" && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    Loading…
                  </div>
                )}
                {root?.status === "error" && (
                  <div className="px-3 py-2 text-[11px] text-destructive">
                    {root.message}
                  </div>
                )}
                {root?.status === "loaded" ? (
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          data-virtual-row-index={virtualRow.index}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderRow(row)}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              key={menuNonce}
              className={COMPACT_CONTENT}
              onCloseAutoFocus={(e) => {
                if (tree.renaming || tree.pendingCreate) e.preventDefault();
              }}
            >
              {menuTarget ? (
                <>
                  {!menuTarget.isDir && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenFile(menuTarget.path, true)}
                    >
                      Open
                    </ContextMenuItem>
                  )}
                  {menuTarget.isDir && onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(menuTarget.path)}
                    >
                      Open in Terminal
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      void openSystemTerminal(menuTarget.path, menuTarget.isDir)
                    }
                  >
                    Open in System Terminal
                  </ContextMenuItem>
                  {isExecutableFile(menuTarget.path, menuTarget.isDir) && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => void executeFile(menuTarget.path)}
                    >
                      Execute
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void revealInFinder(menuTarget.path)}
                  >
                    Reveal in Finder
                  </ContextMenuItem>
                  {menuTarget.isDir && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => {
                        if (onSearchInFolder) {
                          onSearchInFolder(menuTarget.path);
                          onToggleSearchPanel?.(true);
                        } else {
                          setSearchFolder(menuTarget.path);
                        }
                      }}
                    >
                      <HugeiconsIcon icon={Search01Icon} size={14} />
                      <span className="ml-1.5">Search in Folder</span>
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      tree.beginCreate(
                        menuTarget.isDir
                          ? menuTarget.path
                          : parentOf(menuTarget.path, rootPath),
                        "file",
                      )
                    }
                  >
                    New File
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      tree.beginCreate(
                        menuTarget.isDir
                          ? menuTarget.path
                          : parentOf(menuTarget.path, rootPath),
                        "dir",
                      )
                    }
                  >
                    New Folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => {
                      const paths =
                        selectedPaths.size > 0
                          ? Array.from(selectedPaths)
                          : [menuTarget.path];
                      void copyFilesToClipboard(paths);
                    }}
                  >
                    {selectedPaths.size > 0
                      ? `Copy Files (${selectedPaths.size})`
                      : "Copy File"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => {
                      const paths =
                        selectedPaths.size > 0
                          ? Array.from(selectedPaths)
                          : [menuTarget.path];
                      void copyToClipboard(paths.join("\n"));
                    }}
                  >
                    {selectedPaths.size > 0
                      ? `Copy Paths (${selectedPaths.size})`
                      : "Copy Path"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => {
                      const paths =
                        selectedPaths.size > 0
                          ? Array.from(selectedPaths)
                          : [menuTarget.path];
                      const relativePaths = paths.map((p) =>
                        relativePath(rootPath, p),
                      );
                      void copyToClipboard(relativePaths.join("\n"));
                    }}
                  >
                    {selectedPaths.size > 0
                      ? `Copy Relative Paths (${selectedPaths.size})`
                      : "Copy Relative Path"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={async () => {
                      const targetDir = menuTarget.isDir
                        ? menuTarget.path
                        : parentOf(menuTarget.path, rootPath);
                      try {
                        await pasteFilesFromClipboard(targetDir);
                        await tree.refresh(targetDir);
                        if (
                          targetDir !== rootPath &&
                          !tree.expanded.has(targetDir)
                        ) {
                          tree.expand(targetDir);
                        }
                      } catch {
                        // 剪贴板无文件或粘贴失败时静默处理
                      }
                    }}
                  >
                    Paste File
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => onAttachToAgent?.(menuTarget.path)}
                  >
                    Attach to Agent
                  </ContextMenuItem>
                  {gitRepoPath && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger className={COMPACT_ITEM}>
                          <span className="flex items-center gap-1.5">
                            Git
                            <span className="rounded bg-primary/10 px-1 py-px font-mono text-[10px] text-primary">
                              {gitBranch}
                            </span>
                          </span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className={COMPACT_CONTENT}>
                          <ContextMenuItem
                            className={COMPACT_ITEM}
                            onSelect={() => setShowPullDialog(true)}
                          >
                            <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
                            <span className="ml-1.5">Pull</span>
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={COMPACT_ITEM}
                            onSelect={() => setShowCommitDialog(true)}
                          >
                            <HugeiconsIcon icon={DocumentCodeIcon} size={14} />
                            <span className="ml-1.5">Commit...</span>
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={COMPACT_ITEM}
                            onSelect={() => setShowPushDialog(true)}
                          >
                            <HugeiconsIcon icon={ArrowUp01Icon} size={14} />
                            <span className="ml-1.5">Push</span>
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    variant="destructive"
                    onSelect={(e) => {
                      if (deleteConfirm) {
                        const targets = pruneDescendantPaths(
                          selectedPaths.size > 0
                            ? Array.from(selectedPaths)
                            : [menuTarget.path],
                        );
                        void (async () => {
                          for (const p of targets) {
                            await tree.deletePath(p);
                          }
                          setSelectedPaths(new Set());
                        })();
                      } else {
                        // Keep the menu open on the first click so the user
                        // can confirm; let it close normally on the second.
                        e.preventDefault();
                        setDeleteConfirm(true);
                      }
                    }}
                  >
                    {deleteConfirm
                      ? "Click again to confirm"
                      : selectedPaths.size > 0
                        ? `Delete (${selectedPaths.size})`
                        : "Delete"}
                  </ContextMenuItem>
                </>
              ) : (
                <>
                  {onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(rootPath)}
                    >
                      Open in Terminal
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void revealInFinder(rootPath)}
                  >
                    Reveal in Finder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.beginCreate(rootPath, "file")}
                  >
                    New File
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.beginCreate(rootPath, "dir")}
                  >
                    New Folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void copyToClipboard(rootPath)}
                  >
                    Copy Path
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={async () => {
                      try {
                        await pasteFilesFromClipboard(rootPath);
                        await tree.refresh(rootPath);
                      } catch {
                        // 剪贴板无文件或粘贴失败时静默处理
                      }
                    }}
                  >
                    Paste File
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.refresh(rootPath)}
                  >
                    Refresh
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : null}

        {dnd.dragLabel ? (
          <div
            ref={dnd.ghostRef}
            className="pointer-events-none fixed left-0 top-0 z-50 flex items-center gap-1.5 rounded-sm border border-border/70 bg-card/95 px-2 py-1 text-[12px] text-foreground shadow-md"
          >
            {dnd.dragLabel}
          </div>
        ) : null}

        {/* Git Pull 弹窗 */}
        {gitRepoPath && (
          <PullPushDialog
            open={showPullDialog}
            onOpenChange={setShowPullDialog}
            operation="pull"
            repoRoot={gitRepoPath}
            branch={gitBranch}
            onCompleted={() => tree.refresh(gitRepoPath)}
          />
        )}

        {/* Git Push 弹窗 */}
        {gitRepoPath && (
          <PullPushDialog
            open={showPushDialog}
            onOpenChange={setShowPushDialog}
            operation="push"
            repoRoot={gitRepoPath}
            branch={gitBranch}
            onCompleted={() => tree.refresh(gitRepoPath)}
          />
        )}

        {/* Git Commit 弹窗 */}
        {gitRepoPath && (
          <CommitDialog
            open={showCommitDialog}
            onOpenChange={setShowCommitDialog}
            repoRoot={gitRepoPath}
            onCompleted={() => tree.refresh(gitRepoPath)}
          />
        )}

        {/* 文件夹内容搜索弹窗 */}
        <FolderSearchDialog
          open={searchFolder !== null}
          folder={searchFolder ?? ""}
          displayPath={
            searchFolder
              ? searchFolder === rootPath
                ? basename(searchFolder) || searchFolder
                : relativePath(rootPath ?? "", searchFolder)
              : ""
          }
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setSearchFolder(null);
          }}
          onOpenHit={(path, line) => {
            setSearchFolder(null);
            if (onOpenContentHit) onOpenContentHit(path, line);
            else onOpenFile(path);
          }}
        />
      </div>
    );
  }),
);
