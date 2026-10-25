/**
 * Puts finished results where the web app's Experiments pages can read them: public ones in
 * `apps/web/public/experiments/` (committed), private ones in `apps/web/public/private/experiments/`
 * (git-ignored), each folder with an `index.json` listing what is there.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ROOT } from "./kinds/common";

interface IndexEntry {
  id: string;
  title: string;
  question: string;
  kind: string;
  visibility: string;
  runs: number;
  seasons: number;
  conclusion: string;
}

function publishFolder(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  const entries: IndexEntry[] = [];
  for (const f of readdirSync(from)
    .filter((x) => x.endsWith(".json") && !x.endsWith(".spec.json") && x !== "index.json")
    .sort()) {
    const body = JSON.parse(readFileSync(join(from, f), "utf8")) as IndexEntry;
    if (!body.kind || !body.question) continue;
    copyFileSync(join(from, f), join(to, f));
    entries.push({
      id: body.id,
      title: body.title,
      question: body.question,
      kind: body.kind,
      visibility: body.visibility,
      runs: body.runs,
      seasons: body.seasons,
      conclusion: body.conclusion,
    });
  }
  writeFileSync(join(to, "index.json"), JSON.stringify(entries, null, 2) + "\n");
  return entries.length;
}

export function publishExperiments(): { public: number; private: number } {
  return {
    public: publishFolder(
      join(ROOT, "experiments", "results"),
      join(ROOT, "apps", "web", "public", "experiments"),
    ),
    private: publishFolder(
      join(ROOT, "pipeline", "private", "experiments"),
      join(ROOT, "apps", "web", "public", "private", "experiments"),
    ),
  };
}
