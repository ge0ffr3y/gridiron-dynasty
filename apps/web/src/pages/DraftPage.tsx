/**
 * The draft class (Phase 11a): every prospect for the upcoming draft as the
 * viewer's scouts rank him, with the league office's consensus rank beside
 * it, and the viewer team's scouting department (budget and assignments).
 */
import { POSITIONS, type Position } from "@fgm/foundation";
import type { ProspectRow, ScoutingDepartmentView } from "@fgm/sim-core";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, OverallBadge, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHeight, formatLeagueDate } from "@/lib/format";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";
import { BigBoardTab, DraftHistoryTab, DraftRoomTab, MockDraftTab } from "./DraftRoom";

/** "71" with its likely range underneath in small type. */
export function RangeCell({ value, range }: { value: number; range: [number, number] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <OverallBadge value={value} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {range[0]}–{range[1]}
      </span>
    </span>
  );
}

type DraftTab = "room" | "class" | "board" | "mock" | "history";

const DRAFT_TABS: TabItem<DraftTab>[] = [
  { id: "room", label: "Draft room" },
  { id: "class", label: "Class" },
  { id: "board", label: "Big board" },
  { id: "mock", label: "Mock draft" },
  { id: "history", label: "History" },
];

export function DraftPage() {
  const options = useSim("viewingOptions", {}, useLeagueKey());
  const calendar = useSim("calendar", {}, useLeagueKey());
  const live = calendar.data?.stage === "draft";
  const [tab, setTab] = useState<DraftTab | null>(null);
  const shown: DraftTab = tab ?? (live ? "room" : "class");
  const team = options.data?.current ?? null;
  return (
    <div className="flex flex-col gap-6">
      <Tabs
        tabs={DRAFT_TABS}
        value={shown}
        onChange={setTab}
        label="Draft sections"
        idPrefix="draft"
      />
      <TabPanel idPrefix="draft" id={shown} className="flex flex-col gap-6">
        {shown === "room" && <DraftRoomTab viewingTeam={team} />}
        {shown === "class" && <ClassTab team={team} />}
        {shown === "board" && <BigBoardTab viewingTeam={team} />}
        {shown === "mock" && <MockDraftTab />}
        {shown === "history" && <DraftHistoryTab />}
      </TabPanel>
    </div>
  );
}

function ClassTab({ team }: { team: string | null }) {
  const view = useSim("draftClassView", {}, useLeagueKey());
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading what="Loading the draft class" />;
  const v = view.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${v.draftYear} draft class`}
        subtitle={
          <>
            {v.rows.length} prospects, ranked by {v.rankedBy}. Combine{" "}
            {formatLeagueDate(v.combineDate)}; draft {formatLeagueDate(v.draftDate)}. Ratings are
            scouting reads with their likely range, never the truth. Switch "Viewing as" at the top
            to see another team's board.
          </>
        }
      />
      {team && <ScoutingPanel teamId={team} />}
      <ClassTable rows={v.rows} />
    </div>
  );
}

function ClassTable({ rows }: { rows: ProspectRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "viewerRank", desc: false }]);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<"all" | Position>("all");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (position === "all" || r.position === position) &&
        (needle === "" || r.name.toLowerCase().includes(needle)),
    );
  }, [rows, search, position]);

  const columns = useMemo<ColumnDef<ProspectRow>[]>(
    () => [
      { accessorKey: "viewerRank", header: "Rank", meta: { numeric: true } },
      { accessorKey: "consensusRank", header: "Consensus", meta: { numeric: true } },
      {
        accessorKey: "name",
        header: "Name",
        cell: (c) => (
          <Link href={`/prospect/${c.row.original.id}`} className="font-medium hover:underline">
            {c.getValue<string>()}
          </Link>
        ),
      },
      { accessorKey: "position", header: "Pos" },
      { accessorKey: "college", header: "College" },
      { accessorKey: "age", header: "Age", meta: { numeric: true } },
      {
        accessorKey: "heightIn",
        header: "Ht",
        cell: (c) => formatHeight(c.getValue<number>()),
        meta: { numeric: true },
      },
      { accessorKey: "weightLb", header: "Wt", meta: { numeric: true } },
      {
        id: "forty",
        accessorFn: (r) => r.forty ?? 99,
        header: "40",
        cell: (c) =>
          c.row.original.forty !== null ? (
            c.row.original.forty.toFixed(2)
          ) : (
            <span className="text-muted-foreground">{c.row.original.tested ? "—" : "…"}</span>
          ),
        meta: { numeric: true },
      },
      {
        accessorKey: "overall",
        header: "Ovr",
        sortDescFirst: true,
        cell: (c) => <RangeCell value={c.row.original.overall} range={c.row.original.range} />,
      },
      {
        id: "potential",
        accessorFn: (r) => r.potential.estimate,
        header: "Potential",
        sortDescFirst: true,
        cell: (c) => (
          <span className="tabular-nums">
            {c.row.original.potential.range[0]}–{c.row.original.potential.range[1]}
          </span>
        ),
      },
      {
        accessorKey: "confidence",
        header: "Sure",
        sortDescFirst: true,
        cell: (c) => `${Math.round(c.getValue<number>() * 100)}%`,
        meta: { numeric: true },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 100 } },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-56"
          aria-label="Search prospects by name"
        />
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
        <span className="text-xs text-muted-foreground">
          {filtered.length} prospects · "…" = not yet measured
        </span>
      </div>
      <Table caption="Draft prospects">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const numeric = (header.column.columnDef.meta as { numeric?: boolean } | undefined)
                  ?.numeric;
                return (
                  <TableHead
                    key={header.id}
                    className={numeric ? "text-right" : undefined}
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
                const numeric = (cell.column.columnDef.meta as { numeric?: boolean } | undefined)
                  ?.numeric;
                return (
                  <TableCell
                    key={cell.id}
                    className={numeric ? "text-right tabular-nums" : undefined}
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
                No prospects match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {table.getPageCount() > 1 && (
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

/** The viewer team's scouts: budget and assignments (the league office can change any team's). */
function ScoutingPanel({ teamId }: { teamId: string }) {
  const { bump } = useSession();
  const dept = useSim("scoutingDepartmentView", { teamId }, useLeagueKey(teamId));
  const [message, setMessage] = useState<string | null>(null);
  if (dept.error) return <ErrorNote message={dept.error} />;
  if (!dept.data) return <Loading what="Loading scouts" />;
  const d: ScoutingDepartmentView = dept.data;
  const run = (p: Promise<{ message: string }>) =>
    p.then(
      (r) => {
        setMessage(r.message);
        bump();
      },
      (e: unknown) => setMessage(String(e)),
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.team} scouting</CardTitle>
        <CardDescription>
          Each week from September to April, scouts study prospects in their region and position
          group the most, everyone else a little. A bigger budget sharpens every read. The AI
          reassigns its scouts after each draft; until GM Mode the league office can set them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="w-24 text-muted-foreground">Budget</span>
          <Select
            value={d.budget}
            aria-label="Scouting budget"
            onChange={(e) =>
              run(
                call("scoutingMove", {
                  kind: "budget",
                  teamId,
                  budget: e.target.value as ScoutingDepartmentView["budget"],
                }),
              )
            }
          >
            {d.budgets.map((b) => (
              <option key={b} value={b}>
                {b[0]!.toUpperCase() + b.slice(1)}
              </option>
            ))}
          </Select>
        </label>
        {d.scouts.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/coach/${s.id}`} className="w-40 truncate font-medium hover:underline">
              {s.name}
            </Link>
            <span className="w-32 text-xs text-muted-foreground">
              Specialty: {s.specialty ?? "none"}
            </span>
            <Select
              value={s.region ?? ""}
              aria-label={`${s.name}'s region`}
              onChange={(e) =>
                run(
                  call("scoutingMove", {
                    kind: "assign",
                    teamId,
                    scoutId: s.id,
                    region: e.target.value || null,
                    group: s.group,
                  }),
                )
              }
            >
              <option value="">Every region</option>
              {d.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Select
              value={s.group ?? ""}
              aria-label={`${s.name}'s position group`}
              onChange={(e) =>
                run(
                  call("scoutingMove", {
                    kind: "assign",
                    teamId,
                    scoutId: s.id,
                    region: s.region,
                    group: e.target.value || null,
                  }),
                )
              }
            >
              <option value="">Every position</option>
              {d.groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
        ))}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
