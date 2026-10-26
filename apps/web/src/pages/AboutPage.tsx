/**
 * About (Phase 18): what this is, that it is independent and fictional, its license, where the data
 * comes from, and the license of every library that ships in the app.
 */
import { PageHeader } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import licenses from "@/lib/licenses.json";

const DATA: [string, string, string][] = [
  [
    "nflverse",
    "Play-by-play, participation, injuries, rosters, snap counts, draft picks and the combine: the real rates the game is calibrated to.",
    "CC-BY-4.0",
  ],
  [
    "FTN charting, via nflverse",
    "Play-action, screen, RPO and drop rates (one file, shared under the same license).",
    "CC-BY-SA-4.0",
  ],
  ["nfldata (Lee Sharpe)", "Trades and schedules.", "Public data release"],
  [
    "OverTheCap and Pro-Football-Reference",
    "Only counts and curves derived from them: pay by position and rank, award and Hall of Fame shapes.",
    "Terms restrict raw reuse; derived numbers only",
  ],
  [
    "The rulebook and the collective bargaining agreement",
    "League and cap rules, each with a source note.",
    "Facts",
  ],
];

export function AboutPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="About Gridiron Dynasty"
        subtitle="A pro football GM game and league simulator, built around real numbers and fictional names."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this is</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            Every game is simulated play by play, and the league around it runs itself: general
            managers, owners, coaches, the draft, free agency, trades and the cap. Run one team in
            GM Mode or watch all 32 in Simulation Mode. It saves to your browser; nothing leaves
            your computer.
          </p>
          <p>
            This is an independent fan project. It isn&apos;t made, endorsed or sponsored by any
            professional football league, club, players&apos; association or game publisher. Team
            nicknames, people, colleges and the league&apos;s own names are fictional; real city
            names are used only as place names.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">License</CardTitle>
          <CardDescription>
            The code is MIT licensed. One data file is CC-BY-SA-4.0 (the charting numbers).
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where the numbers come from</CardTitle>
          <CardDescription>
            Only numbers derived from these sources are published; the raw data is not.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Source</TableHead>
                <TableHead scope="col">Used for</TableHead>
                <TableHead scope="col">License</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DATA.map(([source, use, license]) => (
                <TableRow key={source}>
                  <TableCell className="whitespace-normal font-medium">{source}</TableCell>
                  <TableCell className="whitespace-normal">{use}</TableCell>
                  <TableCell className="whitespace-normal">{license}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Software in this app</CardTitle>
          <CardDescription>
            {licenses.length} packages, all under permissive licenses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Package</TableHead>
                <TableHead scope="col">Version</TableHead>
                <TableHead scope="col">License</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.map((l) => (
                <TableRow key={`${l.name}@${l.version}`}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>{l.version}</TableCell>
                  <TableCell>{l.license}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
