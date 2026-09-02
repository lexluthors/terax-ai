import { describe, expect, it } from "vitest";
import { buildCopyContext } from "./copyContext";

describe("buildCopyContext", () => {
  it("renders a fenced block with the full path and line range", () => {
    const out = buildCopyContext({
      path: "/proj/src/app.rs",
      language: "rust",
      text: "fn main() {}",
      startLine: 12,
      endLine: 14,
    });
    expect(out).toBe(
      "File: /proj/src/app.rs (lines 12-14)\n\n```rust\nfn main() {}\n```\n",
    );
  });

  it("uses singular 'line' for a single-line selection", () => {
    const out = buildCopyContext({
      path: "/proj/a.md",
      language: "markdown",
      text: "hello",
      startLine: 3,
      endLine: 3,
    });
    expect(out).toContain("File: /proj/a.md (line 3)");
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

  it("uses the path exactly as given", () => {
    const out = buildCopyContext({
      path: "/tmp/x.txt",
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
