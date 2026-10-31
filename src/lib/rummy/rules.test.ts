import { describe, expect, it } from "vitest";
import { analyzeMeld, applyAction, newGame, toPublic, type Card, type GameState } from "./engine";

const c = (id: string): Card => (id.startsWith("X") ? { id, suit: "X", rank: 0 } : { id, suit: id[0] as Card["suit"], rank: parseInt(id.slice(1)) });
const cs = (...ids: string[]) => ids.map(c);
const P = (name: string) => ({ name, token: name, hand: [] as Card[], opened: false, score: 0, ready: false, rematch: false });

function started(): GameState {
  const s = newGame("TEST", 2);
  s.players = [P("Anna"), P("Béla")];
  applyAction(s, 0, { type: "ready" });
  applyAction(s, 1, { type: "ready" });
  s.phase = "play";
  s.turn = 0;
  s.mustOpenWith = null;
  s.takenFromDiscard = null;
  return s;
}

describe("csak dobással lehet nyerni", () => {
  it("a lerakás nem hagyhat üres kezet", () => {
    const s = started();
    s.players[0]!.hand = cs("H11", "H12", "H13", "S10", "D10", "C10");
    expect(() => applyAction(s, 0, { type: "open", groups: [["H11", "H12", "H13"], ["S10", "D10", "C10"]] })).toThrow(/dob/i);
  });
  it("az utolsó lap eldobásával a kör véget ér, kézből záráskor dupla", () => {
    const s = started();
    s.players[0]!.hand = cs("H11", "H12", "H13", "S10", "D10", "C10", "S2");
    s.players[1]!.hand = cs("S3", "S4");
    applyAction(s, 0, { type: "open", groups: [["H11", "H12", "H13"], ["S10", "D10", "C10"]] });
    applyAction(s, 0, { type: "discard", cardId: "S2" });
    expect(s.status).toBe("finished");
    expect(s.winner).toBe(0);
    expect(s.lastRoundHand).toBe(true);
    expect(s.players[0]!.score).toBe(0);
    expect(s.players[1]!.score).toBe((3 + 4) * 2 * 2); // nem rakott le (x2), kézből zártak (x2)
  });
});

describe("joker kiváltás", () => {
  it("a kiváltott joker a kézbe kerül, és addig nem lehet dobni", () => {
    const s = started();
    s.players[0]!.opened = true;
    s.melds = [{ id: "m1", owner: 0, kind: "run", cards: cs("H5", "X1", "H7") }];
    s.players[0]!.hand = cs("H6", "S9", "S2");
    applyAction(s, 0, { type: "layoff", meldId: "m1", cardIds: ["H6"] });
    expect(s.players[0]!.hand.map((x) => x.id)).toContain("X1");
    expect(() => applyAction(s, 0, { type: "discard", cardId: "S9" })).toThrow(/joker/i);
  });
});

describe("négyes sor eltűnése", () => {
  it("a négy különböző színű, joker nélküli sor lekerül az asztalról", () => {
    const s = started();
    s.players[0]!.opened = true;
    s.melds = [{ id: "m1", owner: 0, kind: "set", cards: cs("S9", "H9", "D9") }];
    s.players[0]!.hand = cs("C9", "S2", "S3");
    applyAction(s, 0, { type: "layoff", meldId: "m1", cardIds: ["C9"] });
    expect(s.melds).toHaveLength(0);
    expect(s.retiredCards).toHaveLength(4);
  });
  it("jokeres négyes sor marad", () => {
    const s = started();
    s.players[0]!.opened = true;
    s.melds = [{ id: "m1", owner: 0, kind: "set", cards: cs("S9", "H9", "X1") }];
    s.players[0]!.hand = cs("C9", "S2", "S3");
    applyAction(s, 0, { type: "layoff", meldId: "m1", cardIds: ["C9"] });
    expect(s.melds).toHaveLength(1);
  });
});

describe("handi lap", () => {
  it("soron kívül, kézből zárva használható", () => {
    const s = started();
    s.turn = 0;
    s.handi = c("S5");
    s.players[1]!.hand = cs("S6", "S7", "S8", "H11", "H12", "H13", "D10", "C10", "H10", "S2");
    s.players[0]!.hand = cs("S3");
    s.melds = [];
    applyAction(s, 1, { type: "handiOut", groups: [["S5", "S6", "S7", "S8"], ["H11", "H12", "H13"], ["D10", "C10", "H10"]], discardId: "S2" });
    expect(s.status).toBe("finished");
    expect(s.winner).toBe(1);
    expect(s.lastRoundHand).toBe(true);
  });
  it("lepakolás után nem használható, és a handit fel kell használni", () => {
    const s = started();
    s.handi = c("S5");
    s.players[1]!.opened = true;
    s.players[1]!.hand = cs("S6", "S7", "S8", "S2");
    expect(() => applyAction(s, 1, { type: "handiOut", groups: [["S5", "S6", "S7", "S8"]], discardId: "S2" })).toThrow();
    s.players[1]!.opened = false;
    expect(() => applyAction(s, 1, { type: "handiOut", groups: [["S6", "S7", "S8"]], discardId: "S2" })).toThrow(/handi/i);
  });
});

describe("egy kombinációban legfeljebb egy joker", () => {
  it("két jokeres sor nem rakható le", () => {
    expect(analyzeMeld(cs("S9", "H9", "X1", "X2")).ok).toBe(false);
  });
  it("két jokeres sorozat nem rakható le", () => {
    expect(analyzeMeld(cs("H5", "X1", "H7", "X2", "H9")).ok).toBe(false);
  });
  it("egy jokeres kombináció rendben van", () => {
    expect(analyzeMeld(cs("H5", "X1", "H7")).ok).toBe(true);
  });
  it("jokeres kombinációhoz nem szúrható második joker", () => {
    const s = started();
    s.players[0]!.opened = true;
    s.melds = [{ id: "m1", owner: 0, kind: "run", cards: cs("H5", "X1", "H7") }];
    s.players[0]!.hand = cs("X2", "S9", "S2");
    expect(() => applyAction(s, 0, { type: "layoff", meldId: "m1", cardIds: ["X2"] })).toThrow();
  });
});

describe("maximális büntetőpont", () => {
  function finishWith(limit: number, loserScore: number) {
    const s = newGame("TEST", 2, limit);
    s.players = [P("Anna"), P("Béla")];
    applyAction(s, 0, { type: "ready" });
    applyAction(s, 1, { type: "ready" });
    Object.assign(s, { phase: "play", turn: 0, mustOpenWith: null, takenFromDiscard: null });
    s.players[0]!.opened = true;
    s.players[0]!.hand = cs("S2");
    s.players[1]!.opened = true;
    s.players[1]!.hand = cs("H10"); // 10 büntetőpont
    s.players[1]!.score = loserScore;
    applyAction(s, 0, { type: "discard", cardId: "S2" });
    return s;
  }
  it("ismeretlen limit esetén 500 az alapértelmezés", () => {
    expect(newGame("T", 2, 123).maxPenalty).toBe(500);
  });
  it("a limit alatt a játék folytatódik", () => {
    const s = finishWith(300, 280);
    expect(s.players[1]!.score).toBe(290);
    expect(s.matchOver).toBe(false);
  });
  it("a limit elérésekor a játék véget ér, a legkevesebb pontú nyer", () => {
    const s = finishWith(300, 290);
    expect(s.players[1]!.score).toBe(300);
    expect(s.matchOver).toBe(true);
    expect(toPublic(s).matchWinner).toBe(0);
  });
  it("vége után az új játék nullázza a pontokat", () => {
    const s = finishWith(300, 295);
    applyAction(s, 0, { type: "rematch" });
    applyAction(s, 1, { type: "rematch" });
    expect(s.status).toBe("playing");
    expect(s.players.map((p) => p!.score)).toEqual([0, 0]);
    expect(s.round).toBe(1);
  });
});
