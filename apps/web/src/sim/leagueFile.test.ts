import { createLeague, fingerprint, parseLeague, serializeLeague } from "@fgm/sim-core";
import { describe, expect, it } from "vitest";
import { decodeLeagueFile, encodeLeagueFile, leagueFileName } from "./leagueFile";

describe("league files", () => {
  it("export -> import gives the identical league", async () => {
    const text = serializeLeague(createLeague({ seed: 7, name: "Export Test" }));
    const bytes = await encodeLeagueFile(text);
    expect(bytes.length).toBeLessThan(text.length / 4);
    const back = await decodeLeagueFile(bytes);
    expect(back).toBe(text);
    expect(fingerprint(serializeLeague(parseLeague(back)))).toBe(fingerprint(text));
  });

  it("rejects files that aren't gzip", async () => {
    await expect(decodeLeagueFile(new TextEncoder().encode("hello"))).rejects.toThrow(
      /isn't a FootballGM Sim league file/,
    );
  });

  it("makes safe file names", () => {
    expect(leagueFileName("My League #2!")).toBe("my-league-2.fgmleague");
    expect(leagueFileName("???")).toBe("league.fgmleague");
  });
});
