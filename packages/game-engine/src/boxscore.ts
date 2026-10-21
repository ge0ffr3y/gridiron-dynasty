/**
 * Box score: team stats and every player's stat line, computed from the
 * plays. Because it's built from the play list, the two always agree.
 */
import type { BoxScore, LineupPlayer, Play, Side, StatKey, StatLine, TeamGameStats } from "./types";

const SCRIMMAGE = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

function emptyTeam(): TeamGameStats {
  return {
    points: 0,
    firstDowns: 0,
    plays: 0,
    totalYards: 0,
    passYards: 0,
    rushYards: 0,
    passAtt: 0,
    passCmp: 0,
    sacked: 0,
    sackedYds: 0,
    rushAtt: 0,
    turnovers: 0,
    thirdDownAtt: 0,
    thirdDownConv: 0,
    fourthDownAtt: 0,
    fourthDownConv: 0,
    punts: 0,
    drives: 0,
    possessionSeconds: 0,
    penalties: 0,
    penaltyYards: 0,
    epa: 0,
    epaPlays: 0,
    successPlays: 0,
    dropbacks: 0,
    pressured: 0,
  };
}

export function buildBoxScore(
  plays: Play[],
  /** Everyone who dressed for each team. */
  rosters: Record<Side, LineupPlayer[]>,
  extra: {
    /** Scrimmage snaps each player was on the field for. */
    snaps: Map<number, { off: number; def: number }>;
    periods: Record<Side, number[]>;
    possessionSeconds: Record<Side, number>;
    drives: Record<Side, number>;
  },
): BoxScore {
  const lines = new Map<number, { side: Side; line: StatLine }>();
  for (const side of ["home", "away"] as Side[]) {
    for (const p of rosters[side]) {
      if (lines.has(p.id)) continue;
      const snaps = extra.snaps.get(p.id);
      const line: StatLine = {};
      if (snaps?.off) line.offSnaps = snaps.off;
      if (snaps?.def) line.defSnaps = snaps.def;
      lines.set(p.id, { side, line });
    }
  }
  const add = (id: number | undefined, key: StatKey, n = 1) => {
    if (id === undefined || n === 0) return;
    const entry = lines.get(id);
    if (!entry) return;
    entry.line[key] = (entry.line[key] ?? 0) + n;
  };
  const longest = (id: number | undefined, key: StatKey, n: number) => {
    if (id === undefined) return;
    const entry = lines.get(id);
    if (entry && n > (entry.line[key] ?? -Infinity)) entry.line[key] = n;
  };

  const team: Record<Side, TeamGameStats> = { home: emptyTeam(), away: emptyTeam() };

  for (const p of plays) {
    if (p.penalty?.accepted) {
      const t = team[p.penalty.team];
      t.penalties += 1;
      t.penaltyYards += p.penalty.yards;
      add(p.penalty.player, "penalties");
      add(p.penalty.player, "penaltyYds", p.penalty.yards);
    }
    // A play wiped out by a penalty doesn't count in anyone's stats.
    if (p.noPlay) {
      // A first down by penalty still counts as a first down.
      if (p.firstDown) team[p.offense].firstDowns += 1;
      continue;
    }
    const off = team[p.offense];
    const td = p.touchdown !== undefined;
    const offenseTd = p.touchdown === p.offense;
    // Advanced: expected points added, success (a play that added expected points), pressure.
    const dropback = p.kind === "pass" || p.kind === "sack" || p.kind === "scramble";
    if (p.epa !== undefined && (dropback || p.kind === "run")) {
      off.epa += p.epa;
      off.epaPlays += 1;
      if (p.epa > 0) off.successPlays += 1;
      const qb = p.kind === "scramble" ? p.rusher : p.passer;
      if (dropback) {
        add(qb, "passEpa", p.epa);
        if (p.epa > 0) add(qb, "passSucc");
      } else {
        add(p.rusher, "rushEpa", p.epa);
        if (p.epa > 0) add(p.rusher, "rushSucc");
      }
    }
    if (dropback) {
      off.dropbacks += 1;
      add(p.kind === "scramble" ? p.rusher : p.passer, "dropbacks");
      if (p.pressure !== undefined) off.pressured += 1;
    }
    add(p.pressure, "pressures");
    for (const m of p.missedTackles ?? []) add(m, "missedTkl");
    if (SCRIMMAGE.has(p.kind)) {
      off.plays += 1;
      if (p.firstDown) off.firstDowns += 1;
      if (p.down === 3) {
        off.thirdDownAtt += 1;
        if (p.firstDown) off.thirdDownConv += 1;
      }
      if (p.down === 4 && p.kind !== "kneel") {
        off.fourthDownAtt += 1;
        if (p.firstDown) off.fourthDownConv += 1;
      }
    }
    switch (p.kind) {
      case "run":
      case "scramble":
      case "kneel":
        add(p.rusher, "rushAtt");
        add(p.rusher, "rushYds", p.yards);
        longest(p.rusher, "rushLong", p.yards);
        if (offenseTd) add(p.rusher, "rushTd");
        off.rushAtt += 1;
        off.rushYards += p.yards;
        break;
      case "pass":
      case "spike":
        add(p.passer, "passAtt");
        off.passAtt += 1;
        if (p.kind === "spike") break;
        add(p.receiver, "targets");
        if (p.airYards !== undefined && !p.throwAway) add(p.passer, "airYds", p.airYards);
        if (p.drop) add(p.receiver, "drops");
        if (p.breakup || p.intercepted) add(p.defender, "passDef");
        if (p.complete) {
          add(p.receiver, "yac", p.yards - (p.airYards ?? 0));
          add(p.passer, "passCmp");
          add(p.passer, "passYds", p.yards);
          longest(p.passer, "passLong", p.yards);
          add(p.receiver, "rec");
          add(p.receiver, "recYds", p.yards);
          longest(p.receiver, "recLong", p.yards);
          off.passCmp += 1;
          off.passYards += p.yards;
          if (offenseTd) {
            add(p.passer, "passTd");
            add(p.receiver, "recTd");
          }
        }
        if (p.intercepted) {
          add(p.passer, "passInt");
          add(p.defender, "defInt");
          add(p.defender, "intYds", p.returnYards ?? 0);
          if (td) add(p.defender, "defTd");
          off.turnovers += 1;
        }
        break;
      case "sack":
        add(p.passer, "sacked");
        add(p.passer, "sackedYds", -p.yards);
        add(p.defender, "sacks");
        off.sacked += 1;
        off.sackedYds += -p.yards;
        off.passYards += p.yards;
        break;
      case "fieldGoal":
        add(p.kicker, "fga");
        if (p.good) {
          add(p.kicker, "fgm");
          longest(p.kicker, "fgLong", p.kickDistance ?? 0);
        }
        break;
      case "extraPoint":
        add(p.kicker, "xpa");
        if (p.good) add(p.kicker, "xpm");
        break;
      case "twoPoint":
        if (p.good) {
          add(p.passer, "twoPt");
          add(p.receiver ?? p.rusher, "twoPt");
        }
        break;
      case "punt":
        add(p.kicker, "punts");
        add(p.kicker, "puntYds", p.kickDistance ?? 0);
        off.punts += 1;
        if (p.returner !== undefined && !p.fairCatch) {
          add(p.returner, "pr");
          add(p.returner, "prYds", p.returnYards ?? 0);
          if (td) add(p.returner, "prTd");
        }
        break;
      case "kickoff":
        if (p.returner !== undefined && p.returnYards !== undefined) {
          add(p.returner, "kr");
          add(p.returner, "krYds", p.returnYards);
          if (td) add(p.returner, "krTd");
        }
        break;
      default:
        break;
    }
    for (const t of p.tacklers ?? []) add(t, "tackles");
    if (p.fumble) {
      add(p.fumble.by, "fumbles");
      if (p.fumble.lost) {
        add(p.fumble.by, "fumblesLost");
        add(p.fumble.recoveredBy, "fumRec");
        off.turnovers += 1;
      }
    }
  }

  for (const side of ["home", "away"] as Side[]) {
    const t = team[side];
    t.epa = Math.round(t.epa * 100) / 100;
    t.points = extra.periods[side].reduce((a, b) => a + b, 0);
    t.totalYards = t.passYards + t.rushYards;
    t.drives = extra.drives[side];
    t.possessionSeconds = extra.possessionSeconds[side];
  }

  return {
    periods: { home: extra.periods.home, away: extra.periods.away },
    home: team.home,
    away: team.away,
    // A player who took a snap or did anything on a play appeared in the game.
    players: [...lines.entries()]
      .filter(([, { line }]) => Object.keys(line).length > 0)
      .map(([id, { side, line }]) => {
        for (const key of ["passEpa", "rushEpa"] as StatKey[])
          if (line[key] !== undefined) line[key] = Math.round(line[key] * 100) / 100;
        return { id, side, line: { gp: 1, ...line } };
      }),
  };
}
