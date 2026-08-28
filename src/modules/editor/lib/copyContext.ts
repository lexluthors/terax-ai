export type CopyContextInput = {
  path: string;
  workspaceRoot?: string;
  language?: string | null;
  text: string;
  startLine: number;
  endLine: number;
};

// Relativize against the workspace root for AI prompts; tolerate Windows
// separators and drive-letter case.
export function toDisplayPath(path: string, root: string | undefined): string {
  if (!root) return path;
  const p = path.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!r) return path;
  if (p.startsWith(`${r}/`)) return p.slice(r.length + 1);
  if (/^[a-zA-Z]:\//.test(p) && /^[a-zA-Z]:\//.test(r)) {
    if (p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) {
      return p.slice(r.length + 1);
    }
  }
  return path;
}

export function buildCopyContext(input: CopyContextInput): string {
  const display = toDisplayPath(input.path, input.workspaceRoot);
  const range =
    input.startLine === input.endLine
      ? `line ${input.startLine}`
      : `lines ${input.startLine}-${input.endLine}`;
  const fence = input.language?.trim() ? input.language.trim() : "";
  const text = input.text.endsWith("\n") ? input.text.slice(0, -1) : input.text;
  return `File: ${display} (${range})\n\n\`\`\`${fence}\n${text}\n\`\`\`\n`;
}
