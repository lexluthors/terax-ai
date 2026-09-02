export type CopyContextInput = {
  path: string;
  language?: string | null;
  text: string;
  startLine: number;
  endLine: number;
};

// Always emit the full path so pasted context stays locatable outside the
// current workspace.
export function buildCopyContext(input: CopyContextInput): string {
  const range =
    input.startLine === input.endLine
      ? `line ${input.startLine}`
      : `lines ${input.startLine}-${input.endLine}`;
  const fence = input.language?.trim() ? input.language.trim() : "";
  const text = input.text.endsWith("\n") ? input.text.slice(0, -1) : input.text;
  return `File: ${input.path} (${range})\n\n\`\`\`${fence}\n${text}\n\`\`\`\n`;
}
