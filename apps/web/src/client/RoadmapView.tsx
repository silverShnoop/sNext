import { useEffect, useRef, useState } from "react";

/**
 * The team bulletin: renders the same self-contained page `snext report`
 * exports, so what you see here is exactly what other teams get.
 */
export function RoadmapView({ changeTick }: { changeTick: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(800);
  const [src, setSrc] = useState(`/api/report?t=${Date.now()}`);
  useEffect(() => setSrc(`/api/report?t=${Date.now()}`), [changeTick]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  function fit() {
    const doc = frame.current?.contentDocument;
    if (doc) setHeight(doc.documentElement.scrollHeight + 4);
  }

  return (
    <section className="roadmap">
      <div className="roadmap-bar">
        <p className="muted">The page to share with other teams and leadership: metrics, this sprint's goals, how the last one went, and the plan. Download it as a single HTML file to send or host anywhere.</p>
        <a className="button" href="/api/report" target="_blank" rel="noreferrer">Open</a>
        <a className="button primary" href="/api/report?download=1">Download HTML</a>
      </div>
      <iframe ref={frame} title="Team bulletin" src={src} onLoad={fit} style={{ height }} className="report-frame" />
    </section>
  );
}
