import { useEffect, useRef, useState } from "react";

type MermaidBlockProps = {
  code: string;
};

// Lazy-load mermaid and render the diagram; re-render when code changes.
export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          securityLevel: "loose",
        });
        if (cancelled) return;

        const { svg: rendered } = await mermaid.render(id, code);
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
        Mermaid error: {error}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/50 p-3 text-xs text-muted-foreground">
        <span className="animate-pulse">●</span> Rendering diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram my-4 flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
