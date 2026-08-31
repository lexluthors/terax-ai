import { memo, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Loading01Icon,
  Tick02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import {
  gitPullWithOutput,
  gitPushWithOutput,
  type GitOperationOutputResult,
  type WorkspaceEnv,
} from "./lib/gitOperations";

type OperationType = "pull" | "push";
type OperationStatus = "running" | "success" | "error";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: OperationType;
  repoRoot: string;
  branch: string;
  workspace?: WorkspaceEnv;
  onCompleted?: () => void;
};

export const PullPushDialog = memo(function PullPushDialog({
  open,
  onOpenChange,
  operation,
  repoRoot,
  branch,
  workspace,
  onCompleted,
}: Props) {
  const [status, setStatus] = useState<OperationStatus>("running");
  const [output, setOutput] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setStatus("running");
      setOutput("");
      return;
    }

    let cancelled = false;

    const run = async () => {
      setStatus("running");
      setOutput("");

      let result: GitOperationOutputResult;
      if (operation === "pull") {
        result = await gitPullWithOutput(repoRoot, workspace);
      } else {
        result = await gitPushWithOutput(repoRoot, workspace);
      }

      if (cancelled) return;

      setOutput(result.output);
      setStatus(result.success ? "success" : "error");

      if (result.success) {
        onCompleted?.();
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, operation, repoRoot, workspace, onCompleted]);

  const icon =
    operation === "pull" ? ArrowDown01Icon : ArrowUp01Icon;
  const title = operation === "pull" ? "Pull" : "Push";
  const runningText =
    operation === "pull" ? "Pulling from remote..." : "Pushing to remote...";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={status !== "running"}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={icon} size={18} />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* 分支信息 */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">
              {branch}
            </span>
            <span className="truncate">{repoRoot}</span>
          </div>

          {/* 输出区域 */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            {/* 状态指示 */}
            <div className="mb-2 flex items-center gap-2">
              {status === "running" && (
                <>
                  <HugeiconsIcon
                    icon={Loading01Icon}
                    size={14}
                    className="animate-spin text-primary"
                  />
                  <span className="text-xs text-muted-foreground">
                    {runningText}
                  </span>
                </>
              )}
              {status === "success" && (
                <>
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={14}
                    className="text-green-500"
                  />
                  <span className="text-xs text-green-600 dark:text-green-400">
                    {title} completed successfully
                  </span>
                </>
              )}
              {status === "error" && (
                <>
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={14}
                    className="text-destructive"
                  />
                  <span className="text-xs text-destructive">
                    {title} failed
                  </span>
                </>
              )}
            </div>

            {/* 命令输出 */}
            <div className="relative">
              <div className="absolute top-0 left-0 text-[10px] text-muted-foreground/50">
                $ git {operation}
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-2 pt-5 font-mono text-[11px] leading-relaxed text-foreground/80">
                {status === "running" && !output ? (
                  <span className="text-muted-foreground">
                    Waiting for output...
                  </span>
                ) : (
                  output || "No output"
                )}
              </pre>
            </div>
          </div>

          {/* 关闭按钮 */}
          {status !== "running" && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
