import type { GrepHit } from "@/modules/ai/lib/native";

export type FileGroup = {
  path: string;
  rel: string;
  name: string;
  count: number;
  firstLine: number;
};

/**
 * Aggregate line-level grep hits into one entry per file, preserving the
 * order files were first matched and the first hit's line number (used for
 * jump-to-line on open).
 */
export function groupByFile(hits: GrepHit[]): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const hit of hits) {
    const group = map.get(hit.path);
    if (group) {
      group.count += 1;
    } else {
      const segments = hit.rel.split("/");
      map.set(hit.path, {
        path: hit.path,
        rel: hit.rel,
        name: segments.length ? segments[segments.length - 1] : hit.rel,
        count: 1,
        firstLine: hit.line,
      });
    }
  }
  return [...map.values()];
}
