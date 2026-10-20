import { RosterTable } from "@/components/RosterTable";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { useSession } from "@/lib/session";
import { useSim } from "@/sim/client";

export function PlayersPage() {
  const { league } = useSession();
  const players = useSim("playersView", {}, league?.id ?? "");
  if (players.error) return <ErrorNote message={players.error} />;
  if (!players.data) return <Loading what="Loading players" />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Players" subtitle="Every player in the league. Click a column to sort." />
      <RosterTable rows={players.data} showTeam pageSize={100} />
    </div>
  );
}
