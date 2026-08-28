import { describe, expect, it } from "vitest";
import { pruneDescendantPaths, relativePath } from "./contextActions";

describe("relativePath", () => {
  it("returns '.' when the path is the root itself", () => {
    expect(relativePath("/a/b", "/a/b")).toBe(".");
  });

  it("strips the root prefix for a descendant path", () => {
    expect(relativePath("/a/b", "/a/b/c/d")).toBe("c/d");
  });

  it("does not relativize a sibling that only shares the root prefix", () => {
    expect(relativePath("/a/b", "/a/bc/d")).toBe("/a/bc/d");
  });

  it("returns an unrelated path unchanged", () => {
    expect(relativePath("/a/b", "/x/y")).toBe("/x/y");
  });
});

describe("pruneDescendantPaths", () => {
  it("keeps only the ancestor when descendants are also selected", () => {
    expect(pruneDescendantPaths(["/a/b", "/a/b/c.ts", "/a/b/d/e.ts"])).toEqual([
      "/a/b",
    ]);
  });

  it("keeps unrelated paths", () => {
    expect(pruneDescendantPaths(["/a/b", "/a/c"])).toEqual(["/a/b", "/a/c"]);
  });

  it("does not treat a sibling sharing the prefix as a descendant", () => {
    expect(pruneDescendantPaths(["/a/b", "/a/bc/d"])).toEqual([
      "/a/b",
      "/a/bc/d",
    ]);
  });

  it("returns a single path unchanged", () => {
    expect(pruneDescendantPaths(["/a/b"])).toEqual(["/a/b"]);
  });

  it("returns empty for empty input", () => {
    expect(pruneDescendantPaths([])).toEqual([]);
  });
});
