import { describe, expect, it } from "vitest";
import { GAME_ENGINE_VERSION } from "./index";

describe("game-engine", () => {
  it("exists", () => {
    expect(GAME_ENGINE_VERSION).toBe("0.0.0");
  });
});
