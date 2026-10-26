// Copies the planning notes from the Obsidian vault into docs/ as plain GitHub Markdown.
// The vault stays the source of truth (edit the notes there, then run `npm run sync-docs`).
// What changes on the way: frontmatter is dropped, [[wikilinks]] become ordinary links, and
// Obsidian callouts become GitHub alerts (or a collapsed <details> block for the kickoff prompts).
// Set VAULT to the folder holding "01 - Overview.md" and "02 - Roadmap.md" if it isn't at the default.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const vault =
  process.env["VAULT"] ??
  join(homedir(), "Documents/Obsidian/Obsidian/Projects/FootballGM Sim Project");

const ALERT = {
  abstract: "NOTE",
  info: "NOTE",
  tip: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
};

const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");

export function toGithub(text) {
  let out = text.replace(/^---\n[\s\S]*?\n---\n+/, "");
  out = out
    .split("\n")
    .filter((line) => !line.startsWith("Sibling projects:"))
    .join("\n");

  const lines = out.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^> \[!(\w+)\](-?)\s*(.*)$/);
    if (!head) {
      result.push(lines[i]);
      continue;
    }
    const [, kind, collapsed, title] = head;
    const body = [];
    while (i + 1 < lines.length && lines[i + 1].startsWith(">")) {
      body.push(lines[++i].replace(/^> ?/, ""));
    }
    if (collapsed || !ALERT[kind]) {
      result.push(`<details>\n<summary>${title || kind}</summary>\n`, ...body, "\n</details>");
    } else {
      result.push(`> [!${ALERT[kind]}]`);
      if (title) result.push(`> **${title}**`);
      result.push(...body.map((l) => (l ? `> ${l}` : ">")));
    }
  }
  out = result.join("\n");

  out = out
    .replace(/\[\[02 - Roadmap\]\]/g, "[Roadmap](roadmap.md)")
    .replace(/\[\[01 - Overview\]\]/g, "[Overview](overview.md)")
    .replace(/\[\[#([^\]|]+)\|([^\]]+)\]\]/g, (_, h, label) => `[${label}](#${slug(h)})`)
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [from, to] of [
    ["01 - Overview.md", "docs/overview.md"],
    ["02 - Roadmap.md", "docs/roadmap.md"],
  ]) {
    writeFileSync(to, toGithub(readFileSync(join(vault, from), "utf8")));
    console.log(`${from} -> ${to}`);
  }
}
