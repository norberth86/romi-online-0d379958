import { it, expect } from "vitest";
import { applyAction, newGame, nextSeat, type GameState } from "./engine";
const P = (n: string) => ({ name: n, token: n, hand: [], opened: false, score: 0, ready: false, rematch: false });
function sim(size: number, seed: number) {
  let x = seed; const rand = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const s: GameState = newGame("SIM", size);
  s.players = Array.from({ length: size }, (_, i) => P("J" + i));
  s.players.forEach((_, i) => applyAction(s, i, { type: "ready" }, rand));
  let steps = 0;
  while (s.status === "playing" && steps++ < 3000) {
    const seat = s.turn, me = s.players[seat]!;
    if (s.phase === "draw") {
      try { rand() < 0.3 ? applyAction(s, seat, { type: "takeDiscard" }, rand) : applyAction(s, seat, { type: "drawStock" }, rand); } catch { applyAction(s, seat, { type: "drawStock" }, rand); }
    }
    if (s.mustOpenWith) { applyAction(s, seat, { type: "returnDiscard" }, rand); continue; }
    const ok = me.hand.find((c) => c.id !== s.takenFromDiscard && !(me.requiredJokers ?? []).includes(c.id)) ?? me.hand[0]!;
    applyAction(s, seat, { type: "discard", cardId: ok.id }, rand);
  }
  const tot = s.stock.length + s.discard.length + (s.handi ? 1 : 0) + (s.retiredCards?.length ?? 0) + s.melds.reduce((a, m) => a + m.cards.length, 0) + s.players.reduce((a, p) => a + p!.hand.length, 0);
  return { tot, steps, status: s.status };
}
it("simulates", () => {
  for (const size of [2, 3, 4]) for (let k = 1; k <= 20; k++) { const r = sim(size, k * 7919); expect(r.tot).toBe(108); }
});
