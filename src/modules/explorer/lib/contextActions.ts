import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort; ignore in environments without clipboard permission.
  }
}

export function relativePath(rootPath: string, path: string): string {
  if (path === rootPath) return ".";
  if (path.startsWith(`${rootPath}/`)) return path.slice(rootPath.length + 1);
  return path;
}

// Drop paths already covered by a selected ancestor: deleting the ancestor
// removes them too. Trailing "/" keeps /a/b from matching sibling /a/bc.
export function pruneDescendantPaths(paths: string[]): string[] {
  return paths.filter(
    (p) => !paths.some((other) => other !== p && p.startsWith(`${other}/`)),
  );
}

export async function revealInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (e) {
    console.error("revealItemInDir failed:", e);
  }
}

export async function openSystemTerminal(
  path: string,
  isDirectory: boolean,
): Promise<void> {
  try {
    await invoke("open_system_terminal", { path, isDirectory });
  } catch (e) {
    console.error("openSystemTerminal failed:", e);
    throw e;
  }
}

export async function executeFile(path: string): Promise<void> {
  try {
    await invoke("execute_file", { path });
  } catch (e) {
    console.error("executeFile failed:", e);
    throw e;
  }
}

export async function copyFilesToClipboard(paths: string[]): Promise<void> {
  try {
    await invoke("copy_files_to_clipboard", { paths });
  } catch (e) {
    console.error("copyFilesToClipboard failed:", e);
    throw e;
  }
}

/**
 * 检查文件是否为可执行类型
 */
export function isExecutableFile(filePath: string, isDir: boolean): boolean {
  if (isDir) return false;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".appimage")) return true;
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const ext = lower.slice(dotIndex);
  const executableExts = new Set([".deb", ".apk", ".py", ".sh"]);
  return executableExts.has(ext);
}
