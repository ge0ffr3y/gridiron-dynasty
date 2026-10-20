import type { GameSummary } from "@fgm/sim-core";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { TeamChip } from "./shared";

/** One game: away @ home, with the score once played. The winner is bold. */
export function GameRow({ game }: { game: GameSummary }) {
  const played = game.homeScore !== null && game.awayScore !== null;
  const homeWon = played && game.homeScore! > game.awayScore!;
  const awayWon = played && game.awayScore! > game.homeScore!;
  const side = (team: GameSummary["home"], score: number | null, won: boolean) => (
    <div className={cn("flex items-center gap-2", played && !won && "text-muted-foreground")}>
      <TeamChip team={team} />
      <Link
        href={`/team/${team.id}`}
        className={cn(
          "min-w-0 flex-1 truncate hover:underline",
          won && "font-semibold text-foreground",
        )}
      >
        {team.city} {team.nickname}
      </Link>
      <span className={cn("w-7 text-right tabular-nums", won && "font-semibold text-foreground")}>
        {score ?? ""}
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      {side(game.away, game.awayScore, awayWon)}
      {side(game.home, game.homeScore, homeWon)}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {game.neutral ? "Neutral site" : `at ${game.home.city}`}
          {game.overtime && " · OT"}
          {played && game.homeScore === game.awayScore && " · Tie"}
        </span>
        {played && (
          <Link href={`/game/${game.id}`} className="font-medium text-primary hover:underline">
            Box score
          </Link>
        )}
      </div>
    </div>
  );
}
