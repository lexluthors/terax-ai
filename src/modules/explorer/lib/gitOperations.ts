import { invoke } from "@tauri-apps/api/core";

export interface FileStatus {
  path: string;
  status: string;
  isTracked: boolean;
}

export interface GitStatusResult {
  branch: string;
  files: FileStatus[];
}

export interface GitOperationOutputResult {
  success: boolean;
  output: string;
}

export interface WorkspaceEnv {
  kind: "local" | "wsl";
  localPath: string;
  wslDistros?: string[];
}

/**
 * 检查目录是否为 git 仓库
 */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const result = await invoke<{ repo_root: string } | null>(
      "git_resolve_repo",
      { cwd: path, workspace: undefined }
    );
    return result !== null && result.repo_root !== "";
  } catch {
    return false;
  }
}

/**
 * 获取当前分支名
 */
export async function gitCurrentBranch(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<string> {
  try {
    const result = await invoke<{ branch: string }>(
      "git_resolve_repo",
      { cwd: repoRoot, workspace },
    );
    return result?.branch ?? "HEAD";
  } catch {
    return "HEAD";
  }
}

/**
 * 获取 git 状态
 */
export async function gitStatus(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitStatusResult> {
  try {
    const result = await invoke<{
      repo: { branch: string } | null;
      status: {
        branch: string;
        changedFiles: Array<{
          path: string;
          indexStatus: string;
          worktreeStatus: string;
          untracked: boolean;
        }>;
      } | null;
    }>("git_panel_snapshot", { cwd: repoRoot, workspace });

    const status = result.status;
    if (!status) {
      return { branch: result.repo?.branch ?? "HEAD", files: [] };
    }

    const files: FileStatus[] = status.changedFiles.map((f) => ({
      path: f.path,
      status: `${f.indexStatus}${f.worktreeStatus}`.replace(/ /g, "") || "?",
      isTracked: !f.untracked,
    }));

    return {
      branch: status.branch,
      files,
    };
  } catch (e) {
    console.error("gitStatus failed:", e);
    return { branch: "HEAD", files: [] };
  }
}

/**
 * Git pull（带输出）
 */
export async function gitPullWithOutput(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitOperationOutputResult> {
  try {
    return await invoke<GitOperationOutputResult>(
      "git_pull_with_output",
      { repoRoot, workspace },
    );
  } catch (e) {
    return { success: false, output: String(e) };
  }
}

/**
 * Git push（带输出）
 */
export async function gitPushWithOutput(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitOperationOutputResult> {
  try {
    return await invoke<GitOperationOutputResult>(
      "git_push_with_output",
      { repoRoot, workspace },
    );
  } catch (e) {
    return { success: false, output: String(e) };
  }
}

/**
 * Git commit（带输出）
 */
export async function gitCommitWithOutput(
  repoRoot: string,
  message: string,
  files: string[],
  workspace?: WorkspaceEnv,
): Promise<GitOperationOutputResult> {
  try {
    return await invoke<GitOperationOutputResult>(
      "git_commit_with_output",
      { repoRoot, message, files, workspace },
    );
  } catch (e) {
    return { success: false, output: String(e) };
  }
}

/**
 * 回滚已跟踪文件
 */
export async function gitDiscard(
  repoRoot: string,
  files: string[],
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_discard", {
    repoRoot,
    entries: files.map((path) => ({ path, staged: false })),
    workspace,
  });
}

/**
 * 删除未跟踪的文件
 */
export async function gitDeleteUntracked(
  repoRoot: string,
  files: string[],
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_delete_untracked", {
    repoRoot,
    files,
    workspace,
  });
}
