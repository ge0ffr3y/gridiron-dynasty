/**
 * The transactions log: every roster and contract move, newest first, each with
 * its reason. Filter by team and by kind of move.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export function TransactionsPage({ teamId: initialTeam }: { teamId?: string }) {
  const [teamId, setTeamId] = useState(initialTeam ?? "");
  const [group, setGroup] = useState("");
  const view = useSim(
    "transactionsView",
    { teamId: teamId || undefined, group: group || undefined },
    useLeagueKey(`tx:${teamId}:${group}`),
  );
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        subtitle="Every signing, cut, claim, trade and roster move, newest first, with the reason it happened."
      />
      <div className="flex flex-wrap gap-2">
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
          <option value="">All teams</option>
          {v.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Kind of move">
          <option value="">All moves</option>
          {v.groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <span className="self-center text-sm text-muted-foreground">
          {v.total.toLocaleString()} moves
          {v.total > v.rows.length ? `, latest ${v.rows.length} shown` : ""}
        </span>
      </div>
      <Card className="py-2">
        <CardContent className="flex flex-col divide-y px-4">
          {v.rows.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">No moves yet.</p>
          )}
          {v.rows.map((t) => (
            <div key={t.id} className="flex flex-col gap-0.5 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-nums text-xs text-muted-foreground">
                  {formatLeagueDate(t.date)}
                </span>
                <span>{t.text}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t.reason}
                {t.players.length > 0 && (
                  <span>
                    {" · "}
                    {t.players.slice(0, 6).map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <Link href={`/player/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
