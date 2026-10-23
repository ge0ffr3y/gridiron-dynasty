/**
 * Screens for moods and disputes (Phase 12b): a team's locker room, and the league's
 * holdouts, hold-ins and trade requests.
 */
import { ageOn } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { perceivePlayer, type Viewer } from "../perception";
import { MORALE, moodLabel, moodReason, teamChemistry } from "./morale";

export interface MoodRow {
  id: number;
  name: string;
  position: string;
  age: number;
  overall: number;
  mood: number;
  label: string;
  reason: string;
  /** Leadership as his teammates see it (a word, not the hidden number). */
  leader: boolean;
}

export interface LockerRoomView {
  teamId: string;
  chemistry: number;
  chemistryLabel: string;
  /** League rank by chemistry (1 = best). */
  rank: number;
  /** What it does on game day, in rating points (small by design). */
  gamePoints: number;
  leaders: MoodRow[];
  unhappy: MoodRow[];
  disruptive: MoodRow[];
  /** Moods across the roster: thrilled, happy, content, unhappy, angry. */
  spread: { label: string; count: number }[];
  disputes: DisputeRow[];
}

export interface DisputeRow {
  playerId: number;
  name: string;
  position: string;
  teamId: string;
  season: number;
  kind: "holdout" | "hold-in" | "trade-request";
  start: string;
  end: string | null;
  outcome: string | null;
  reason: string;
  response: string;
  fines: number;
}

function chemistryLabel(score: number): string {
  if (score >= 56) return "Tight-knit";
  if (score >= 51) return "Good";
  if (score >= 46) return "Typical";
  if (score >= 40) return "Tense";
  return "Divided";
}

function row(league: League, p: Player, viewer: Viewer): MoodRow {
  return {
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    position: p.position,
    age: ageOn(p.birthDate, league.date),
    overall: perceivePlayer(league, p, viewer).overall,
    mood: Math.round(p.mood?.score ?? MORALE.neutral),
    label: moodLabel(p.mood?.score ?? MORALE.neutral),
    reason: moodReason(p),
    // Teammates know who the leaders are; the number itself stays hidden.
    leader: p.personality.leadership >= 70,
  };
}

function disputeRow(league: League, d: League["disputes"][number]): DisputeRow {
  const p = league.players.find((x) => x.id === d.playerId);
  return {
    playerId: d.playerId,
    name: p ? `${p.firstName} ${p.lastName}` : `Player ${d.playerId}`,
    position: p?.position ?? "",
    teamId: d.teamId,
    season: d.season,
    kind: d.kind,
    start: d.start,
    end: d.end,
    outcome: d.outcome,
    reason: d.reason,
    response: d.response,
    fines: d.fines,
  };
}

/** A team's locker room: chemistry, its leaders, the unhappy, and its disputes. */
export function lockerRoomView(league: League, teamId: string, viewer: Viewer): LockerRoomView {
  const chem = teamChemistry(league, teamId);
  const all = league.teams
    .map((t) => ({ id: t.id, score: teamChemistry(league, t.id).score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const byId = new Map(league.players.map((p) => [p.id, p]));
  const roster = league.players.filter(
    (p) => p.teamId === teamId && p.retiredAfter === null && p.roster !== "practice-squad",
  );
  const labels = ["Thrilled", "Happy", "Content", "Unhappy", "Angry"];
  return {
    teamId,
    chemistry: chem.score,
    chemistryLabel: chemistryLabel(chem.score),
    rank: all.findIndex((t) => t.id === teamId) + 1,
    gamePoints:
      Math.round(
        MORALE.gameChemistry * Math.max(-1, Math.min(1, (chem.score - MORALE.neutral) / 50)) * 100,
      ) / 100,
    leaders: chem.leaders.map((id) => row(league, byId.get(id)!, viewer)),
    unhappy: chem.unhappy.slice(0, 12).map((id) => row(league, byId.get(id)!, viewer)),
    disruptive: chem.disruptive.map((id) => row(league, byId.get(id)!, viewer)),
    spread: labels.map((label) => ({
      label,
      count: roster.filter((p) => moodLabel(p.mood?.score ?? MORALE.neutral) === label).length,
    })),
    disputes: league.disputes
      .filter((d) => d.teamId === teamId)
      .reverse()
      .map((d) => disputeRow(league, d)),
  };
}

export interface DisputesView {
  open: DisputeRow[];
  /** This season's and last season's, newest first. */
  recent: DisputeRow[];
  /** Teams by chemistry, best first. */
  chemistry: { teamId: string; score: number; label: string }[];
}

/** The league's holdouts, hold-ins and trade requests, and every team's chemistry. */
export function disputesView(league: League): DisputesView {
  return {
    open: league.disputes.filter((d) => d.end === null).map((d) => disputeRow(league, d)),
    recent: league.disputes
      .filter((d) => d.end !== null && d.season >= league.season - 1)
      .reverse()
      .map((d) => disputeRow(league, d)),
    chemistry: league.teams
      .map((t) => {
        const score = teamChemistry(league, t.id).score;
        return { teamId: t.id, score, label: chemistryLabel(score) };
      })
      .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId)),
  };
}
