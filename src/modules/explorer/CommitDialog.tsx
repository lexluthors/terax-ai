import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete01Icon,
  DocumentCodeIcon,
  FolderCheckIcon,
} from "@hugeicons/core-free-icons";
import {
  gitStatus,
  gitCommitWithOutput,
  gitDiscard,
  gitDeleteUntracked,
  type FileStatus,
  type GitOperationOutputResult,
  type WorkspaceEnv,
} from "./lib/gitOperations";
import { PullPushDialog } from "./PullPushDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
  workspace?: WorkspaceEnv;
  onCompleted?: () => void;
};

export const CommitDialog = memo(function CommitDialog({
  open,
  onOpenChange,
  repoRoot,
  workspace,
  onCompleted,
}: Props) {
  const [branch, setBranch] = useState("HEAD");
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);

  // 加载 git status
  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    const result = await gitStatus(repoRoot, workspace);
    setBranch(result.branch);
    setFiles(result.files);
    setSelectedFiles(new Set());
    setIsLoading(false);
  }, [repoRoot, workspace]);

  useEffect(() => {
    if (open) {
      setRollbackConfirm(false);
      void loadStatus();
    }
  }, [open, loadStatus]);

  // 分组文件
  const { trackedFiles, untrackedFiles } = useMemo(() => {
    const tracked = files.filter((f) => f.isTracked);
    const untracked = files.filter((f) => !f.isTracked);
    return { trackedFiles: tracked, untrackedFiles: untracked };
  }, [files]);

  // 选择/取消选择文件
  const toggleFile = useCallback((path: string) => {
    // 选择变化时解除待确认态，防止对不同的文件集合误执行
    setRollbackConfirm(false);
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // 全选/取消全选分区
  const toggleGroup = useCallback(
    (groupFiles: FileStatus[]) => {
      setRollbackConfirm(false);
      const paths = groupFiles.map((f) => f.path);
      const allSelected = paths.every((p) => selectedFiles.has(p));
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          for (const p of paths) next.delete(p);
        } else {
          for (const p of paths) next.add(p);
        }
        return next;
      });
    },
    [selectedFiles],
  );

  // 回滚选中文件
  const handleRollback = useCallback(async () => {
    const selected = Array.from(selectedFiles);
    if (selected.length === 0) return;

    const tracked = selected.filter((p) =>
      trackedFiles.some((f) => f.path === p),
    );
    const untracked = selected.filter((p) =>
      untrackedFiles.some((f) => f.path === p),
    );

    try {
      if (tracked.length > 0) {
        await gitDiscard(repoRoot, tracked, workspace);
      }
      if (untracked.length > 0) {
        await gitDeleteUntracked(repoRoot, untracked, workspace);
      }
      await loadStatus();
    } catch (e) {
      console.error("Rollback failed:", e);
    }
  }, [selectedFiles, trackedFiles, untrackedFiles, repoRoot, workspace, loadStatus]);

  // 提交
  const handleCommit = useCallback(
    async (andPush: boolean) => {
      const selected = Array.from(selectedFiles);
      if (selected.length === 0 || !commitMessage.trim()) return;

      const result: GitOperationOutputResult = await gitCommitWithOutput(
        repoRoot,
        commitMessage.trim(),
        selected,
        workspace,
      );

      if (result.success) {
        if (andPush) {
          setShowPushDialog(true);
        } else {
          onCompleted?.();
          onOpenChange(false);
        }
      } else {
        console.error("Commit failed:", result.output);
      }
    },
    [selectedFiles, commitMessage, repoRoot, workspace, onCompleted, onOpenChange],
  );

  const hasSelection = selectedFiles.size > 0;
  const hasMessage = commitMessage.trim().length > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={DocumentCodeIcon} size={18} />
              Commit
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 分支信息 */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                {branch}
              </span>
              <span className="truncate">{repoRoot}</span>
            </div>

            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : files.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No changes to commit
              </div>
            ) : (
              <>
                {/* 已跟踪文件 */}
                {trackedFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Modified ({trackedFiles.length})
                      </span>
                      <Checkbox
                        checked={trackedFiles.every((f) =>
                          selectedFiles.has(f.path),
                        )}
                        onCheckedChange={() => toggleGroup(trackedFiles)}
                      />
                    </div>
                    <div className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-border bg-muted/30 p-1">
                      {trackedFiles.map((file) => (
                        <FileItem
                          key={file.path}
                          file={file}
                          checked={selectedFiles.has(file.path)}
                          onToggle={() => toggleFile(file.path)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 未跟踪文件 */}
                {untrackedFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Untracked ({untrackedFiles.length})
                      </span>
                      <Checkbox
                        checked={untrackedFiles.every((f) =>
                          selectedFiles.has(f.path),
                        )}
                        onCheckedChange={() => toggleGroup(untrackedFiles)}
                      />
                    </div>
                    <div className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-border bg-muted/30 p-1">
                      {untrackedFiles.map((file) => (
                        <FileItem
                          key={file.path}
                          file={file}
                          checked={selectedFiles.has(file.path)}
                          onToggle={() => toggleFile(file.path)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Commit Message */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Commit Message
              </label>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Enter commit message..."
                className="h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center justify-between">
              <Button
                variant={rollbackConfirm ? "destructive" : "outline"}
                size="sm"
                disabled={!hasSelection}
                onClick={() => {
                  if (rollbackConfirm) {
                    setRollbackConfirm(false);
                    void handleRollback();
                  } else {
                    setRollbackConfirm(true);
                  }
                }}
              >
                {rollbackConfirm ? (
                  <span>Click again to confirm</span>
                ) : (
                  <>
                    <HugeiconsIcon icon={Delete01Icon} size={14} />
                    <span className="ml-1">Rollback</span>
                  </>
                )}
              </Button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!hasSelection || !hasMessage}
                  onClick={() => void handleCommit(false)}
                >
                  <HugeiconsIcon icon={FolderCheckIcon} size={14} />
                  <span className="ml-1">Commit</span>
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!hasSelection || !hasMessage}
                  onClick={() => void handleCommit(true)}
                >
                  Commit & Push
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Push 弹窗 */}
      <PullPushDialog
        open={showPushDialog}
        onOpenChange={(open) => {
          setShowPushDialog(open);
          if (!open) {
            onCompleted?.();
            onOpenChange(false);
          }
        }}
        operation="push"
        repoRoot={repoRoot}
        branch={branch}
        workspace={workspace}
        onCompleted={onCompleted}
      />
    </>
  );
});

// 文件列表项
function FileItem({
  file,
  checked,
  onToggle,
}: {
  file: FileStatus;
  checked: boolean;
  onToggle: () => void;
}) {
  const statusColor = file.isTracked
    ? "text-amber-500"
    : "text-muted-foreground";

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent/50"
      onClick={onToggle}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className={`font-mono text-[10px] ${statusColor}`}>
        {file.status || "?"}
      </span>
      <span className="flex-1 truncate font-mono text-xs">{file.path}</span>
    </div>
  );
}
