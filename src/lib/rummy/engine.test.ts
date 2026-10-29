import { describe, expect, it } from "vitest";
import { analyzeMeld, applyAction, handValue, newGame, toPublic, type Card, type GameState } from "./engine";

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
  it("accepts Q-K-A worth 30 (ace 10)", () => {
    const r = analyzeMeld(cs("S12", "S13", "S1"));
    expect(r.ok && r.points).toBe(30);
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
  it("deals 15 to the starter, 14 to the other, starter begins by discarding", () => {
    const s = game();
    expect(s.status).toBe("playing");
    expect(s.players[0]!.hand).toHaveLength(15);
    expect(s.players[1]!.hand).toHaveLength(14);
    expect(s.discard).toHaveLength(0);
    expect(s.stock).toHaveLength(108 - 29);
    expect(s.turn).toBe(0);
    expect(s.phase).toBe("play");
    expect(() => applyAction(s, 0, { type: "drawStock" })).toThrow();
  });
  it("rejects opening below 51 points", () => {
    const s = game();
    s.players[0]!.hand = cs("H2", "H3", "H4", "S9");
    expect(() => applyAction(s, 0, { type: "open", groups: [["H2", "H3", "H4"]] })).toThrow(/51/);
  });
  it("accepts opening with 51+ points", () => {
    const s = game();
    s.players[0]!.hand = cs("H11", "H12", "H13", "S10", "D10", "C10", "S2");
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

const total = (s: GameState) =>
  s.stock.length + s.discard.length + s.players.reduce((a, p) => a + p!.hand.length, 0) + s.melds.reduce((a, m) => a + m.cards.length, 0);

describe("ace and joker values", () => {
  it("A-2-3: ace 1", () => { const r = analyzeMeld(cs("S1", "S2", "S3")); expect(r.ok && r.points).toBe(6); });
  it("Q-K-A: ace 10", () => { const r = analyzeMeld(cs("S12", "S13", "S1")); expect(r.ok && r.points).toBe(30); });
  it("ace set: 10 each", () => { const r = analyzeMeld(cs("S1", "H1", "D1")); expect(r.ok && r.points).toBe(30); });
  it("joker takes substituted value in set", () => { const r = analyzeMeld(cs("S13", "H13", "X1")); expect(r.ok && r.points).toBe(30); });
  it("ace left in hand counts 10", () => expect(handValue(c("S1"))).toBe(10));
});

describe("discard pickup rule (per player first turn)", () => {
  function started() {
    const s = game();
    // Starter (0) discards on their first move.
    applyAction(s, 0, { type: "discard", cardId: s.players[0]!.hand[0]!.id });
    return s;
  }
  it("second player may freely take the discard on their own first turn", () => {
    const s = started();
    expect(s.players[0]!.firstTurnDone).toBe(true);
    expect(s.players[1]!.firstTurnDone).toBe(false);
    applyAction(s, 1, { type: "takeDiscard" });
    expect(s.mustOpenWith).toBeNull();
    applyAction(s, 1, { type: "discard", cardId: s.players[1]!.hand.find((x) => x.id !== s.takenFromDiscard)!.id });
    expect(s.turn).toBe(0);
  });
  it("starter (already past first turn, not opened) must open with taken discard", () => {
    const s = started();
    applyAction(s, 1, { type: "drawStock" });
    s.players[1]!.hand.push(c("H5")); s.stock = s.stock.filter((x) => x.id !== "H5");
    applyAction(s, 1, { type: "discard", cardId: "H5" });
    applyAction(s, 0, { type: "takeDiscard" });
    expect(s.mustOpenWith).toBe("H5");
    expect(() => applyAction(s, 0, { type: "discard", cardId: s.players[0]!.hand[0]!.id })).toThrow(/51/);
    applyAction(s, 0, { type: "returnDiscard" });
    expect(s.discard[s.discard.length - 1]!.id).toBe("H5");
    expect(() => applyAction(s, 0, { type: "takeDiscard" })).toThrow();
    applyAction(s, 0, { type: "drawStock" });
    expect(s.players[0]!.hand).toHaveLength(15);
  });
  it("second player from their own 2nd turn is also restricted", () => {
    const s = started();
    applyAction(s, 1, { type: "drawStock" });
    applyAction(s, 1, { type: "discard", cardId: s.players[1]!.hand[0]!.id });
    applyAction(s, 0, { type: "drawStock" });
    applyAction(s, 0, { type: "discard", cardId: s.players[0]!.hand[0]!.id });
    applyAction(s, 1, { type: "takeDiscard" });
    expect(s.mustOpenWith).not.toBeNull();
  });
  it("restricted pickup succeeds when opening ≥51 with the card", () => {
    const s = started();
    applyAction(s, 1, { type: "drawStock" });
    applyAction(s, 1, { type: "discard", cardId: s.players[1]!.hand[0]!.id });
    s.discard.push(c("H13"));
    s.players[0]!.hand = cs("H11", "H12", "S10", "D10", "C10", "S2", "D4");
    applyAction(s, 0, { type: "takeDiscard" });
    expect(() => applyAction(s, 0, { type: "open", groups: [["S10", "D10", "C10"]] })).toThrow();
    applyAction(s, 0, { type: "open", groups: [["H11", "H12", "H13"], ["S10", "D10", "C10"]] });
    expect(s.players[0]!.opened).toBe(true);
    applyAction(s, 0, { type: "discard", cardId: "S2" });
    expect(s.turn).toBe(1);
  });
  it("after opening, discard pickup is free", () => {
    const s = started();
    s.players[1]!.opened = true;
    applyAction(s, 1, { type: "drawStock" });
    applyAction(s, 1, { type: "discard", cardId: s.players[1]!.hand[0]!.id });
    applyAction(s, 0, { type: "drawStock" });
    applyAction(s, 0, { type: "discard", cardId: s.players[0]!.hand[0]!.id });
    applyAction(s, 1, { type: "takeDiscard" });
    expect(s.mustOpenWith).toBeNull();
  });
  it("conserves all 108 cards", () => {
    const s = started();
    expect(total(s)).toBe(108);
    applyAction(s, 1, { type: "drawStock" });
    applyAction(s, 1, { type: "discard", cardId: s.players[1]!.hand[0]!.id });
    applyAction(s, 0, { type: "takeDiscard" });
    applyAction(s, 0, { type: "returnDiscard" });
    applyAction(s, 0, { type: "drawStock" });
    expect(total(s)).toBe(108);
  });
  it("cannot lay off before opening", () => {
    const s = started();
    s.melds.push({ id: "m9", owner: 1, kind: "set", cards: cs("S7", "H7", "D7") });
    s.players[1]!.hand.push(c("C7"));
    applyAction(s, 1, { type: "drawStock" });
    expect(() => applyAction(s, 1, { type: "layoff", meldId: "m9", cardIds: ["C7"] })).toThrow();
  });
});

describe("going out and scoring", () => {
  it("winner gets loser's hand value, doubled when loser never opened", () => {
    const s = game();
    s.players[0]!.hand = cs("S5");
    s.players[0]!.opened = true;
    s.players[1]!.hand = cs("H1", "X1", "D7");
    applyAction(s, 0, { type: "discard", cardId: "S5" });
    expect(s.status).toBe("finished");
    expect(s.winner).toBe(0);
    expect(s.lastRoundPoints).toBe((10 + 20 + 7) * 2);
    expect(s.starter).toBe(1);
  });
});
