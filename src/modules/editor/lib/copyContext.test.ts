import { describe, expect, it } from "vitest";
import { buildCopyContext, toDisplayPath } from "./copyContext";

describe("toDisplayPath", () => {
  it("strips the workspace root prefix", () => {
    expect(toDisplayPath("/home/u/proj/src/a.ts", "/home/u/proj")).toBe(
      "src/a.ts",
    );
  });

  it("does not match a sibling that only shares the prefix", () => {
    expect(toDisplayPath("/home/u/proj2/a.ts", "/home/u/proj")).toBe(
      "/home/u/proj2/a.ts",
    );
  });

  it("returns the path unchanged without a root", () => {
    expect(toDisplayPath("/a/b.ts", undefined)).toBe("/a/b.ts");
  });

  it("normalizes windows separators", () => {
    expect(
      toDisplayPath("C:\\Users\\u\\proj\\src\\a.ts", "C:/Users/u/proj"),
    ).toBe("src/a.ts");
  });

  it("ignores drive letter case on windows", () => {
    expect(toDisplayPath("c:/Users/u/proj/a.ts", "C:\\Users\\u\\proj")).toBe(
      "a.ts",
    );
  });

  it("tolerates a trailing separator on the root", () => {
    expect(toDisplayPath("/a/b/c.ts", "/a/b/")).toBe("c.ts");
  });
});

describe("buildCopyContext", () => {
  it("renders a fenced block with file and line range", () => {
    const out = buildCopyContext({
      path: "/proj/src/app.rs",
      workspaceRoot: "/proj",
      language: "rust",
      text: "fn main() {}",
      startLine: 12,
      endLine: 14,
    });
    expect(out).toBe(
      "File: src/app.rs (lines 12-14)\n\n```rust\nfn main() {}\n```\n",
    );
  });

  it("uses singular 'line' for a single-line selection", () => {
    const out = buildCopyContext({
      path: "/proj/a.md",
      workspaceRoot: "/proj",
      language: "markdown",
      text: "hello",
      startLine: 3,
      endLine: 3,
    });
    expect(out).toContain("(line 3)");
  });

  it("omits the fence language when unknown", () => {
    const out = buildCopyContext({
      path: "/proj/LICENSE",
      language: null,
      text: "MIT",
      startLine: 1,
      endLine: 2,
    });
    expect(out).toContain("\n```\nMIT\n");
  });

  it("keeps the absolute path when outside the workspace root", () => {
    const out = buildCopyContext({
      path: "/tmp/x.txt",
      workspaceRoot: "/proj",
      language: "txt",
      text: "t",
      startLine: 1,
      endLine: 1,
    });
    expect(out).toContain("File: /tmp/x.txt");
  });

  it("drops one trailing newline from the selection", () => {
    const out = buildCopyContext({
      path: "/proj/a.txt",
      language: "txt",
      text: "line one\nline two\n",
      startLine: 1,
      endLine: 3,
    });
    expect(out).toBe(
      "File: /proj/a.txt (lines 1-3)\n\n```txt\nline one\nline two\n```\n",
    );
  });
});
