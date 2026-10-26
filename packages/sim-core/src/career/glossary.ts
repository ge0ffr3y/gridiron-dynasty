/**
 * The glossary (Phase 14b): cap and roster terms in plain English. Numbers come from this
 * league's rules file, so the page matches the rules the league actually plays by.
 */
import type { League } from "../league/schema";
import { salaryCap } from "../contracts/cap";

export interface GlossaryEntry {
  term: string;
  group: "Money" | "Contracts" | "Roster" | "Players' rights" | "The year";
  text: string;
}

const m = (d: number) => `$${(d / 1_000_000).toFixed(1)}M`;

export function glossaryView(league: League): GlossaryEntry[] {
  const r = league.rules;
  const cap = r.cap;
  const roster = r.roster;
  const fa = r.freeAgency;
  const entries: GlossaryEntry[] = [
    {
      term: "Salary cap",
      group: "Money",
      text: `The most a team may count against its books in a League Year: ${m(salaryCap(cap, league.season))} this year. Every contract's cap hit counts; teams over the cap must get under before they can sign anyone.`,
    },
    {
      term: "Cap hit",
      group: "Money",
      text: "What a contract counts against the cap this year: the base salary plus this year's share of any signing bonus, plus roster and workout bonuses and likely incentives.",
    },
    {
      term: "Cap room",
      group: "Money",
      text: `The cap minus everything counting against it. In the offseason only the top ${cap.offseasonTopContracts} cap hits count (the rest of a ${roster.offseasonMax}-man roster doesn't).`,
    },
    {
      term: "Top 51",
      group: "Money",
      text: `Between the League Year and the season, only a team's ${cap.offseasonTopContracts} biggest cap hits count against the cap, so camp bodies don't crowd it.`,
    },
    {
      term: "Dead money",
      group: "Money",
      text: "Cap charges for players no longer on the team: bonus money already paid but not yet counted, and guarantees still owed. Releasing or trading a player speeds up his remaining bonus charges.",
    },
    {
      term: "Proration",
      group: "Money",
      text: `A signing bonus is paid up front but counts evenly over the contract's years, at most ${cap.maxProrationYears}. That's how teams spread a big deal's cost.`,
    },
    {
      term: "Void years",
      group: "Money",
      text: "Fake years added to the end of a contract so a bonus spreads further. When the deal voids, the bonus left over lands on the cap at once as dead money.",
    },
    {
      term: "Restructure",
      group: "Money",
      text: "Turning this year's salary into a signing bonus: he gets the same money, but it spreads over the remaining years, so this year's cap hit falls and later years' rise.",
    },
    {
      term: "June 1 release",
      group: "Money",
      text: `Releasing a player as a "post-June 1" cut splits his dead money over this year and next instead of all at once. A team may designate ${cap.juneFirstDesignationsPerYear} a year.`,
    },
    {
      term: "Minimum salary",
      group: "Contracts",
      text: `The least a player can be paid, rising with his credited seasons: ${m(cap.minimumSalary.active[String(league.season)]?.[0] ?? 0)} for a rookie this year.`,
    },
    {
      term: "Guaranteed money",
      group: "Contracts",
      text: "Salary the player gets even if he's released. What's still guaranteed when he's cut becomes dead money.",
    },
    {
      term: "Rookie contract",
      group: "Contracts",
      text: `Drafted players sign set ${cap.rookieScale.years}-year deals sized by draft slot (first-rounders get a fifth-year team option). They can't be redone until after the ${fa.rookieExtensionAfterSeasons}rd season.`,
    },
    {
      term: "Fifth-year option",
      group: "Contracts",
      text: "A first-round pick's team may add a fifth year to his rookie deal at a set salary, by tiers of how much he has played.",
    },
    {
      term: "Extension",
      group: "Contracts",
      text: "New years added to a contract before it runs out, usually for a starter in his deal's last year or two.",
    },
    {
      term: "Franchise tag",
      group: "Players' rights",
      text: `Keeps a player whose deal ran out for one year at a set price: the average of the top ${cap.tags.franchiseTopN} salaries at his position (or ${Math.round((cap.tags.priorSalaryMultiplier - 1) * 100)}% more than his last salary, if that's higher). ${fa.tags.designationsPerYear === 1 ? "One tag a year" : `${fa.tags.designationsPerYear} tags a year`}. Other teams may offer him a deal, but the price is two first-round picks.`,
    },
    {
      term: "Transition tag",
      group: "Players' rights",
      text: `Like the franchise tag, priced at the top ${cap.tags.transitionTopN} average: his team may match any offer, but gets no picks if it doesn't.`,
    },
    {
      term: "Restricted free agent",
      group: "Players' rights",
      text: `A player with ${fa.restrictedAccruedSeasons} accrued seasons whose deal ran out. A tender holds his rights for a year: other teams may sign him to an offer sheet, which his team can match or take draft-pick compensation for.`,
    },
    {
      term: "Exclusive-rights free agent",
      group: "Players' rights",
      text: `A player with fewer than ${fa.exclusiveRightsBelowAccruedSeasons} accrued seasons. A minimum tender keeps him: he can't talk to other teams.`,
    },
    {
      term: "Offer sheet",
      group: "Players' rights",
      text: `A contract a tendered player signs with another team. His own team has ${fa.offerSheet.matchDays} days to match it, or lets him go for the tender's pick compensation.`,
    },
    {
      term: "Active roster",
      group: "Roster",
      text: `Up to ${roster.offseasonMax} players in the offseason, ${roster.regularSeasonMax} from final cuts on. ${roster.gameDayActives} of them dress for each game.`,
    },
    {
      term: "Practice squad",
      group: "Roster",
      text: `Up to ${roster.practiceSquad.max} players (plus ${roster.practiceSquad.internationalExemption} international) who practice but don't play, paid weekly; at most ${roster.practiceSquad.veteransMax} veterans. Other teams may sign them to their 53.`,
    },
    {
      term: "Elevation",
      group: "Roster",
      text: `Bringing a practice-squad player up for one game without signing him to the 53: ${roster.practiceSquad.elevationsPerGame} a game, ${roster.practiceSquad.elevationsPerPlayerPerSeason} times a season per player.`,
    },
    {
      term: "Injured reserve",
      group: "Roster",
      text: `A list for players out a while: they come off the 53 and must miss at least ${roster.reserve.injuredMinGames} games. A team may bring ${roster.reserve.returnsPerSeason} back a season.`,
    },
    {
      term: "PUP and NFI",
      group: "Roster",
      text: `Physically Unable to Perform (a football injury) and Non-Football Injury lists: players still hurt at final cuts can sit out at least ${roster.reserve.pupMinGames} games without taking a roster spot.`,
    },
    {
      term: "Waivers",
      group: "Roster",
      text: `A released player with fewer than ${roster.waivers.vestedVeteranSeasons} accrued seasons goes on waivers first: teams may claim him (and his contract) worst team first (by the draft order through week ${roster.waivers.draftOrderThroughWeek}, then by this season's standings). Vested veterans become free agents at once.`,
    },
    {
      term: "League Year",
      group: "The year",
      text: "The league's business year, starting in March: contracts expire, free agency opens and the new cap applies.",
    },
    {
      term: "Compensatory picks",
      group: "The year",
      text: "Extra draft picks for teams that lost more (or better) free agents than they signed the year before.",
    },
    {
      term: "Black Monday",
      group: "The year",
      text: "The day after the regular season, when owners fire head coaches and general managers.",
    },
  ];
  return entries;
}
