/**
 * League files on disk: the league's JSON text, gzip-compressed with the
 * browser's built-in CompressionStream (about 6x smaller).
 */

export const LEAGUE_FILE_EXTENSION = ".fgmleague";

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeLeagueFile(text: string): Promise<Uint8Array> {
  const input = new Blob([text]).stream();
  return streamBytes(input.pipeThrough(new CompressionStream("gzip")));
}

export async function decodeLeagueFile(bytes: Uint8Array): Promise<string> {
  try {
    const input = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
    const raw = await streamBytes(input.pipeThrough(new DecompressionStream("gzip")));
    return new TextDecoder().decode(raw);
  } catch {
    throw new Error("This file isn't a FootballGM Sim league file (it couldn't be decompressed).");
  }
}

/** A safe file name from a league name. */
export function leagueFileName(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "league";
  return `${slug}${LEAGUE_FILE_EXTENSION}`;
}
