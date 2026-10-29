import type { ItemLink } from "./types.js";

const DETECTORS: { system: string; pattern: RegExp }[] = [
  { system: "jira", pattern: /\/browse\/([A-Z][A-Z0-9_]+-\d+)/ },
  { system: "jira", pattern: /[?&]selectedIssue=([A-Z][A-Z0-9_]+-\d+)/ },
  { system: "github", pattern: /github\.com\/([^/]+\/[^/]+\/(?:issues|pull)\/\d+)/ },
  { system: "linear", pattern: /linear\.app\/[^/]+\/issue\/([A-Z0-9]+-\d+)/ },
];

/** Fill in `system` and `key` from well-known URL shapes when not given. */
export function normalizeLink(link: ItemLink): ItemLink {
  const out = { ...link };
  if (!out.system || !out.key) {
    for (const { system, pattern } of DETECTORS) {
      const m = pattern.exec(out.url);
      if (m) {
        out.system ??= system;
        out.key ??= m[1];
        break;
      }
    }
  }
  return out;
}
