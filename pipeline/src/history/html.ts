/**
 * Reads the stats tables on the archived reference pages: every cell carries a `data-stat` name,
 * so a row becomes a map from stat name to its text, link and (for players) site id.
 */

export interface Cell {
  text: string;
  href: string | null;
  /** The site's player id (`data-append-csv`), when the cell names a player. */
  id: string | null;
}
export type Row = Record<string, Cell>;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

/** Strips tags and tidies whitespace. */
export function text(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** All data rows of the table with this id (or the first table), skipping header rows. */
export function tableRows(html: string, id?: string): Row[] {
  const start = id ? html.indexOf(`id="${id}"`) : html.indexOf("<table");
  if (start < 0) return [];
  const end = html.indexOf("</table>", start);
  // Header rows live in <thead> (and repeat inside long tables): data rows only.
  const body = html.slice(start, end < 0 ? undefined : end).replace(/<thead[\s\S]*?<\/thead>/g, "");
  const rows: Row[] = [];
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row: Row = {};
    for (const c of tr[1]!.matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const stat = /data-stat="([^"]+)"/.exec(c[2]!)?.[1];
      if (!stat) continue;
      row[stat] = {
        text: text(c[3]!),
        href: /<a [^>]*href="([^"]+)"/.exec(c[3]!)?.[1] ?? null,
        id: /data-append-csv="([^"]+)"/.exec(c[2]!)?.[1] ?? null,
      };
    }
    // Header rows repeat inside long tables; they have no player or year.
    if (Object.keys(row).length > 1 && !/class="thead"/.test(tr[0]!.slice(0, 40))) rows.push(row);
  }
  return rows;
}

export const num = (c: Cell | undefined): number => {
  const n = Number((c?.text ?? "").replace(/[,+]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
