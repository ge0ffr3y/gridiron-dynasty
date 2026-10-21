/**
 * Stat tables grouped like a box score: passing, rushing, receiving, defense,
 * kicking, punting, returns. A group only appears if someone has stats in it.
 */
import type { StatLine } from "@fgm/game-engine";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface StatRow {
  key: string;
  label: string;
  href?: string;
  line: StatLine;
  /** Shown in bold (e.g. a career total). */
  emphasis?: boolean;
}

const n = (line: StatLine, key: keyof StatLine) => line[key] ?? 0;
const avg = (a: number, b: number) => (b > 0 ? (a / b).toFixed(1) : "-");
const rate = (a: number, b: number) => (b > 0 ? (a / b).toFixed(2) : "-");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "-");

/** The NFL passer rating formula. */
export function passerRating(line: StatLine): string {
  const att = n(line, "passAtt");
  if (att === 0) return "-";
  const clamp = (v: number) => Math.min(2.375, Math.max(0, v));
  const a = clamp((n(line, "passCmp") / att - 0.3) * 5);
  const b = clamp((n(line, "passYds") / att - 3) * 0.25);
  const c = clamp((n(line, "passTd") / att) * 20);
  const d = clamp(2.375 - (n(line, "passInt") / att) * 25);
  return (((a + b + c + d) / 6) * 100).toFixed(1);
}

type Column = [string, (line: StatLine) => string | number];

const GROUPS: { title: string; has: (keyof StatLine)[]; columns: Column[] }[] = [
  {
    title: "Passing",
    has: ["passAtt"],
    columns: [
      ["C/ATT", (l) => `${n(l, "passCmp")}/${n(l, "passAtt")}`],
      ["YDS", (l) => n(l, "passYds")],
      ["AVG", (l) => avg(n(l, "passYds"), n(l, "passAtt"))],
      ["TD", (l) => n(l, "passTd")],
      ["INT", (l) => n(l, "passInt")],
      ["SCK", (l) => n(l, "sacked")],
      ["LNG", (l) => n(l, "passLong")],
      ["RTG", passerRating],
    ],
  },
  {
    title: "Rushing",
    has: ["rushAtt"],
    columns: [
      ["CAR", (l) => n(l, "rushAtt")],
      ["YDS", (l) => n(l, "rushYds")],
      ["AVG", (l) => avg(n(l, "rushYds"), n(l, "rushAtt"))],
      ["TD", (l) => n(l, "rushTd")],
      ["LNG", (l) => n(l, "rushLong")],
      ["FUM", (l) => n(l, "fumblesLost")],
    ],
  },
  {
    title: "Receiving",
    has: ["targets"],
    columns: [
      ["REC", (l) => n(l, "rec")],
      ["TGT", (l) => n(l, "targets")],
      ["YDS", (l) => n(l, "recYds")],
      ["AVG", (l) => avg(n(l, "recYds"), n(l, "rec"))],
      ["TD", (l) => n(l, "recTd")],
      ["LNG", (l) => n(l, "recLong")],
    ],
  },
  {
    title: "Defense",
    has: ["tackles", "sacks", "defInt", "fumRec"],
    columns: [
      ["TKL", (l) => n(l, "tackles")],
      ["SCK", (l) => n(l, "sacks")],
      ["INT", (l) => n(l, "defInt")],
      ["INT YDS", (l) => n(l, "intYds")],
      ["FR", (l) => n(l, "fumRec")],
      ["TD", (l) => n(l, "defTd")],
    ],
  },
  {
    title: "Advanced offense",
    has: ["offSnaps"],
    columns: [
      ["SNAPS", (l) => n(l, "offSnaps")],
      ["EPA/DB", (l) => rate(n(l, "passEpa"), n(l, "dropbacks"))],
      ["DB SUCC", (l) => pct(n(l, "passSucc"), n(l, "dropbacks"))],
      ["EPA/RUSH", (l) => rate(n(l, "rushEpa"), n(l, "rushAtt"))],
      ["RUSH SUCC", (l) => pct(n(l, "rushSucc"), n(l, "rushAtt"))],
      ["AIR YDS", (l) => n(l, "airYds")],
      ["YAC", (l) => n(l, "yac")],
      ["DROPS", (l) => n(l, "drops")],
    ],
  },
  {
    title: "Advanced defense",
    has: ["defSnaps"],
    columns: [
      ["SNAPS", (l) => n(l, "defSnaps")],
      ["PRESSURES", (l) => n(l, "pressures")],
      ["PASSES DEF", (l) => n(l, "passDef")],
      ["MISSED TKL", (l) => n(l, "missedTkl")],
    ],
  },
  {
    title: "Kicking",
    has: ["fga", "xpa"],
    columns: [
      ["FG", (l) => `${n(l, "fgm")}/${n(l, "fga")}`],
      ["PCT", (l) => (n(l, "fga") ? `${Math.round((100 * n(l, "fgm")) / n(l, "fga"))}%` : "-")],
      ["LNG", (l) => n(l, "fgLong") || "-"],
      ["XP", (l) => `${n(l, "xpm")}/${n(l, "xpa")}`],
    ],
  },
  {
    title: "Punting",
    has: ["punts"],
    columns: [
      ["NO", (l) => n(l, "punts")],
      ["YDS", (l) => n(l, "puntYds")],
      ["AVG", (l) => avg(n(l, "puntYds"), n(l, "punts"))],
    ],
  },
  {
    title: "Returns",
    has: ["kr", "pr"],
    columns: [
      ["KR", (l) => n(l, "kr")],
      ["KR YDS", (l) => n(l, "krYds")],
      ["PR", (l) => n(l, "pr")],
      ["PR YDS", (l) => n(l, "prYds")],
      ["TD", (l) => n(l, "krTd") + n(l, "prTd")],
    ],
  },
];

export function StatTables({
  rows,
  firstColumn = "Player",
}: {
  rows: StatRow[];
  firstColumn?: string;
}) {
  const groups = GROUPS.filter((g) => rows.some((r) => g.has.some((k) => n(r.line, k) > 0)));
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">No stats yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const members = rows.filter((r) => group.has.some((k) => n(r.line, k) > 0));
        return (
          <div key={group.title}>
            <h4 className="mb-1 text-sm font-semibold">{group.title}</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{firstColumn}</TableHead>
                  {group.columns.map(([label]) => (
                    <TableHead key={label} className="text-right">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((r) => (
                  <TableRow key={r.key} className={cn(r.emphasis && "font-semibold")}>
                    <TableCell>
                      {r.href ? (
                        <Link href={r.href} className="hover:underline">
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </TableCell>
                    {group.columns.map(([label, get]) => (
                      <TableCell key={label} className="text-right tabular-nums">
                        {get(r.line)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}
