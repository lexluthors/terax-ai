import type { GrepHit } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import { groupByFile } from "./folderSearch";

function hit(path: string, rel: string, line: number): GrepHit {
  return { path, rel, line, text: "match" };
}

describe("groupByFile", () => {
  it("returns an empty list for no hits", () => {
    expect(groupByFile([])).toEqual([]);
  });

  it("aggregates multiple hits in one file into a single group", () => {
    const groups = groupByFile([
      hit("/a/src/app.ts", "src/app.ts", 3),
      hit("/a/src/app.ts", "src/app.ts", 41),
    ]);
    expect(groups).toEqual([
      {
        path: "/a/src/app.ts",
        rel: "src/app.ts",
        name: "app.ts",
        count: 2,
        firstLine: 3,
      },
    ]);
  });

  it("keeps first-seen file order and per-file first line", () => {
    const groups = groupByFile([
      hit("/a/b.ts", "b.ts", 9),
      hit("/a/a.ts", "a.ts", 1),
      hit("/a/b.ts", "b.ts", 2),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["b.ts", "a.ts"]);
    expect(groups[0].count).toBe(2);
    expect(groups[0].firstLine).toBe(9);
    expect(groups[1].count).toBe(1);
  });

  it("derives the name from the last relative path segment", () => {
    const groups = groupByFile([
      hit("/a/deep/nested/file.rs", "deep/nested/file.rs", 1),
    ]);
    expect(groups[0].name).toBe("file.rs");
    expect(groups[0].rel).toBe("deep/nested/file.rs");
  });
});
