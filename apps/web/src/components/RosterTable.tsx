/**
 * Sortable, filterable player table (TanStack Table), used for a team's roster
 * and for the league-wide player list.
 */
import { POSITIONS, type Position } from "@fgm/foundation";
import type { RosterRow } from "@fgm/sim-core";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHeight } from "@/lib/format";
import { DisputeTag, InjuryTag, FitTag, ListTag, MoodTag, OverallBadge } from "./shared";

const POSITION_ORDER = new Map<Position, number>(POSITIONS.map((p, i) => [p, i]));

type SideFilter = "all" | "offense" | "defense" | "special";

/** Column hints: numbers right-aligned; `low` columns drop out on a phone; the name stays in view. */
interface ColumnMeta {
  numeric?: boolean;
  low?: boolean;
  sticky?: boolean;
}

function columnClass(meta: ColumnMeta | undefined, header: boolean): string | undefined {
  return cn(
    meta?.low && "hidden md:table-cell",
    meta?.sticky &&
      "sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)] md:static md:shadow-none",
    meta?.sticky && header && "bg-card",
  );
}

export function RosterTable({
  rows,
  showTeam = false,
  pageSize,
}: {
  rows: RosterRow[];
  showTeam?: boolean;
  /** Rows per page; omit to show every row. */
  pageSize?: number;
}) {
  // Grouped by position to start. Rows arrive best-first, and ties keep that order,
  // so each position group lists its best players first.
  const [sorting, setSorting] = useState<SortingState>([{ id: "position", desc: false }]);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<"all" | Position>("all");
  const [side, setSide] = useState<SideFilter>("all");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          (position === "all" || r.position === position) &&
          (side === "all" || r.side === side) &&
          (needle === "" || r.name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.overall - a.overall || a.id - b.id);
  }, [rows, search, position, side]);

  const columns = useMemo<ColumnDef<RosterRow>[]>(
    () => [
      {
        accessorKey: "jersey",
        header: "#",
        meta: { low: true },
        cell: (c) => (
          <span className="tabular-nums text-muted-foreground">{c.getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "name",
        header: "Name",
        meta: { sticky: true },
        cell: (c) => (
          <>
            <Link href={`/player/${c.row.original.id}`} className="font-medium hover:underline">
              {c.getValue<string>()}
            </Link>
            <ListTag list={c.row.original.list} />
            <InjuryTag injury={c.row.original.injury} />
            <DisputeTag kind={c.row.original.dispute} />
          </>
        ),
      },
      {
        accessorKey: "position",
        header: "Pos",
        sortingFn: (a, b) =>
          (POSITION_ORDER.get(a.original.position) ?? 0) -
          (POSITION_ORDER.get(b.original.position) ?? 0),
      },
      ...(showTeam
        ? [
            {
              accessorKey: "teamAbbreviation",
              header: "Team",
              cell: (c) =>
                c.row.original.teamId ? (
                  <Link href={`/team/${c.row.original.teamId}`} className="hover:underline">
                    {c.getValue<string>()}
                  </Link>
                ) : (
                  "FA"
                ),
            } satisfies ColumnDef<RosterRow>,
          ]
        : []),
      { accessorKey: "age", header: "Age", meta: { numeric: true } },
      {
        accessorKey: "heightIn",
        header: "Ht",
        cell: (c) => formatHeight(c.getValue<number>()),
        meta: { numeric: true, low: true },
      },
      { accessorKey: "weightLb", header: "Wt", meta: { numeric: true, low: true } },
      {
        accessorKey: "experience",
        header: "Exp",
        cell: (c) => (c.getValue<number>() === 0 ? "R" : c.getValue<number>()),
        meta: { numeric: true, low: true },
      },
      {
        accessorKey: "overall",
        header: "Ovr",
        sortDescFirst: true,
        cell: (c) => <OverallBadge value={c.getValue<number>()} />,
        meta: { numeric: true },
      },
      {
        id: "fit",
        accessorFn: (r) => r.fit?.score ?? 0,
        header: "Fit",
        sortDescFirst: true,
        cell: (c) => <FitTag label={c.row.original.fit?.label ?? null} always />,
        meta: { low: true },
      },
      {
        id: "mood",
        accessorFn: (r) => r.mood?.score ?? -1,
        header: "Mood",
        sortDescFirst: true,
        cell: (c) => <MoodTag mood={c.row.original.mood} always />,
        meta: { low: true },
      },
    ],
    [showTeam],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize } },
        }
      : {}),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-56"
          aria-label="Search players by name"
        />
        <Select
          value={side}
          onChange={(e) => setSide(e.target.value as SideFilter)}
          aria-label="Side of the ball"
        >
          <option value="all">All sides</option>
          <option value="offense">Offense</option>
          <option value="defense">Defense</option>
          <option value="special">Special teams</option>
        </Select>
        <Select
          value={position}
          onChange={(e) => setPosition(e.target.value as "all" | Position)}
          aria-label="Position"
        >
          <option value="all">All positions</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} players</span>
      </div>

      <Table caption="Players">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                const numeric = meta?.numeric;
                return (
                  <TableHead
                    key={header.id}
                    className={cn(numeric && "text-right", columnClass(meta, true))}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === "asc" && <ArrowUp className="size-3" />}
                      {sorted === "desc" && <ArrowDown className="size-3" />}
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                const numeric = meta?.numeric;
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(numeric && "text-right tabular-nums", columnClass(meta, false))}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-6 text-center text-muted-foreground"
              >
                No players match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {pageSize && table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
