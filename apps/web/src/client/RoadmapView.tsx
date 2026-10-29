import { useEffect, useRef, useState } from "react";

/**
 * Leadership view. Renders the same self-contained report `snext report`
 * exports, so what you see here is exactly what you send.
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
        <p className="muted">What the team signed up to and how it went: the exact page leadership gets when you export it.</p>
        <a className="button" href="/api/report" target="_blank" rel="noreferrer">Open</a>
        <a className="button primary" href="/api/report?download=1">Download HTML</a>
      </div>
      <iframe ref={frame} title="Roadmap report" src={src} onLoad={fit} style={{ height }} className="report-frame" />
    </section>
  );
}
