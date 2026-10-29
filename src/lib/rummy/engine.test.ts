import { describe, expect, it } from "vitest";
import { analyzeMeld, applyAction, newGame, toPublic, type Card, type GameState } from "./engine";

const c = (id: string): Card => {
  if (id.startsWith("X")) return { id, suit: "X", rank: 0 };
  return { id, suit: id[0] as Card["suit"], rank: parseInt(id.slice(1)) };
};
const cs = (...ids: string[]) => ids.map(c);

describe("meld validation", () => {
  it("accepts a set of 3 different suits", () => expect(analyzeMeld(cs("H7", "S7", "D7")).ok).toBe(true));
  it("rejects a set with duplicate suit", () => expect(analyzeMeld(cs("H7", "H7", "D7")).ok).toBe(false));
  it("accepts a run with a joker gap", () => {
    const r = analyzeMeld(cs("H5", "X1", "H7"));
    expect(r.ok && r.kind === "run" && r.points).toBe(18);
  });
  it("accepts Q-K-A worth 31", () => {
    const r = analyzeMeld(cs("S12", "S13", "S1"));
    expect(r.ok && r.points).toBe(31);
  });
  it("A-2-3 worth 6", () => {
    const r = analyzeMeld(cs("S1", "S2", "S3"));
    expect(r.ok && r.points).toBe(6);
  });
  it("rejects K-A-2 wraparound", () => expect(analyzeMeld(cs("S13", "S1", "S2")).ok).toBe(false));
  it("rejects more jokers than naturals", () => expect(analyzeMeld(cs("S5", "X1", "X2")).ok).toBe(false));
});

function game(): GameState {
  const s = newGame("ABCD");
  const p = (name: string) => ({ name, token: name, hand: [], opened: false, score: 0, ready: false, rematch: false });
  s.players = [p("Anna"), p("Béla")];
  applyAction(s, 0, { type: "ready" });
  applyAction(s, 1, { type: "ready" });
  return s;
}

describe("game flow", () => {
  it("deals 13 cards each and starts", () => {
    const s = game();
    expect(s.status).toBe("playing");
    expect(s.players[0]!.hand).toHaveLength(13);
    expect(s.stock.length + s.discard.length).toBe(108 - 26);
  });
  it("rejects opening below 51 points", () => {
    const s = game();
    s.players[0]!.hand = cs("H2", "H3", "H4", "S9");
    s.phase = "play";
    expect(() => applyAction(s, 0, { type: "open", groups: [["H2", "H3", "H4"]] })).toThrow(/51/);
  });
  it("accepts opening with 51+ points", () => {
    const s = game();
    s.players[0]!.hand = cs("H11", "H12", "H13", "S10", "D10", "C10", "S2");
    s.phase = "play";
    applyAction(s, 0, { type: "open", groups: [["H11", "H12", "H13"], ["S10", "D10", "C10"]] });
    expect(s.players[0]!.opened).toBe(true);
  });
  it("forbids playing out of turn", () => {
    const s = game();
    expect(() => applyAction(s, 1, { type: "drawStock" })).toThrow();
  });
  it("public state never contains hands during play", () => {
    const s = game();
    const pub = JSON.stringify(toPublic(s));
    expect(pub).not.toContain('"hand"');
    expect(toPublic(s).revealedHands).toBeNull();
  });
});
