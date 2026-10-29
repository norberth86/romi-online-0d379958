// Pure, framework-free rummy rules. Runs on the server as the single source of truth.
export type Suit = "S" | "H" | "D" | "C" | "X"; // X = joker
export type Card = { id: string; suit: Suit; rank: number }; // joker rank 0, ace 1
export type MeldKind = "set" | "run";
export type Meld = { id: string; owner: number; kind: MeldKind; cards: Card[] };

export const OPEN_MIN = 51;
export const STARTER_HAND = 15;
export const SECOND_HAND = 14;
const SUITS: Suit[] = ["S", "H", "D", "C"];

export function makeDeck(): Card[] {
  const cards: Card[] = [];
  for (const d of ["a", "b"]) {
    for (const s of SUITS) for (let r = 1; r <= 13; r++) cards.push({ id: `${s}${r}${d}`, suit: s, rank: r });
    cards.push({ id: `X1${d}`, suit: "X", rank: 0 }, { id: `X2${d}`, suit: "X", rank: 0 });
  }
  return cards;
}

export function shuffle<T>(arr: T[], rand: () => number = secureRandom): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function secureRandom() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 2 ** 32;
}

/** Penalty value of a card left in hand. */
export function handValue(c: Card): number {
  if (c.suit === "X") return 20;
  if (c.rank === 1) return 10;
  return c.rank >= 10 ? 10 : c.rank;
}

function posValue(pos: number) {
  if (pos === 1) return 1;
  if (pos === 14) return 10;
  return pos >= 10 ? 10 : pos;
}

export type Analysis =
  | { ok: true; kind: MeldKind; points: number; ordered: Card[] }
  | { ok: false; reason: string };

const isJoker = (c: Card) => c.suit === "X";

function analyzeSet(cards: Card[]): Analysis {
  const nat = cards.filter((c) => !isJoker(c));
  const jok = cards.length - nat.length;
  if (cards.length < 3 || cards.length > 4) return { ok: false, reason: "Egy sor 3–4 lapból áll." };
  if (nat.length === 0 || jok > nat.length) return { ok: false, reason: "Túl sok joker." };
  const rank = nat[0].rank;
  if (nat.some((c) => c.rank !== rank)) return { ok: false, reason: "Nem azonos értékűek." };
  if (new Set(nat.map((c) => c.suit)).size !== nat.length) return { ok: false, reason: "Ismétlődő szín a sorban." };
  const v = rank === 1 ? 10 : rank >= 10 ? 10 : rank;
  return { ok: true, kind: "set", points: v * cards.length, ordered: [...nat, ...cards.filter(isJoker)] };
}

function analyzeRun(cards: Card[]): Analysis {
  const nat = cards.filter((c) => !isJoker(c));
  const jokers = cards.filter(isJoker);
  const len = cards.length;
  if (len < 3) return { ok: false, reason: "Legalább 3 lap kell." };
  if (len > 13) return { ok: false, reason: "Túl hosszú sorozat." };
  if (nat.length === 0 || jokers.length > nat.length) return { ok: false, reason: "Túl sok joker." };
  if (nat.some((c) => c.suit !== nat[0].suit)) return { ok: false, reason: "Nem azonos színűek." };
  for (const aceHigh of [false, true]) {
    const mapped = nat.map((c) => ({ c, r: c.rank === 1 && aceHigh ? 14 : c.rank })).sort((a, b) => a.r - b.r);
    const rs = mapped.map((m) => m.r);
    if (new Set(rs).size !== rs.length) return { ok: false, reason: "Ismétlődő lap a sorozatban." };
    const min = rs[0];
    const max = rs[rs.length - 1];
    const span = max - min + 1;
    if (span > len) continue;
    const extra = len - span;
    const top = Math.min(14 - max, extra);
    const hi = max + top;
    const lo = min - (extra - top);
    if (lo < 1 || hi - lo + 1 > 13) continue;
    const ordered: Card[] = [];
    let j = 0;
    let points = 0;
    for (let p = lo; p <= hi; p++) {
      const m = mapped.find((x) => x.r === p);
      ordered.push(m ? m.c : jokers[j++]);
      points += posValue(p);
    }
    return { ok: true, kind: "run", points, ordered };
  }
  return { ok: false, reason: "Nem egymást követő lapok." };
}

export function analyzeMeld(cards: Card[]): Analysis {
  const s = analyzeSet(cards);
  if (s.ok) return s;
  const r = analyzeRun(cards);
  if (r.ok) return r;
  const nat = cards.filter((c) => !isJoker(c));
  const sameRank = nat.every((c) => c.rank === nat[0]?.rank);
  return sameRank ? s : r;
}

// ---------------- Game state ----------------
export type Player = {
  name: string;
  token: string;
  hand: Card[];
  opened: boolean;
  score: number;
  ready: boolean;
  rematch: boolean;
  /** Per-player: has this player finished their own first turn in the current round? */
  firstTurnDone?: boolean;
};

export type GameState = {
  v: number;
  code: string;
  status: "lobby" | "playing" | "finished";
  players: [Player | null, Player | null];
  stock: Card[];
  discard: Card[];
  melds: Meld[];
  turn: number;
  phase: "draw" | "play";
  starter: number;
  round: number;
  winner: number | null;
  lastRoundPoints: number;
  takenFromDiscard: string | null;
  /** Card taken from discard that must be part of the 51-point opening this turn. */
  mustOpenWith?: string | null;
  /** Player put the discard back this turn and must draw from stock. */
  discardRefused?: boolean;
  meldCounter: number;
  log: string[];
};

export type Action =
  | { type: "ready" }
  | { type: "drawStock" }
  | { type: "takeDiscard" }
  | { type: "open"; groups: string[][] }
  | { type: "meld"; cardIds: string[] }
  | { type: "layoff"; meldId: string; cardIds: string[] }
  | { type: "discard"; cardId: string }
  | { type: "returnDiscard" }
  | { type: "rematch" };

export class RuleError extends Error {}

export function newGame(code: string): GameState {
  return {
    v: 0, code, status: "lobby", players: [null, null], stock: [], discard: [], melds: [],
    turn: 0, phase: "draw", starter: 0, round: 0, winner: null, lastRoundPoints: 0,
    takenFromDiscard: null, meldCounter: 0, log: [],
  };
}

function log(s: GameState, msg: string) {
  s.log = [...s.log, msg].slice(-8);
}

export function deal(s: GameState, rand?: () => number) {
  const deck = shuffle(makeDeck(), rand);
  s.players.forEach((p, i) => {
    if (!p) throw new RuleError("Hiányzik a második játékos.");
    p.hand = deck.splice(0, i === s.starter ? STARTER_HAND : SECOND_HAND);
    p.opened = false;
    p.ready = false;
    p.rematch = false;
    p.firstTurnDone = false;
  });
  s.discard = [];
  s.stock = deck;
  s.melds = [];
  s.status = "playing";
  s.turn = s.starter;
  // The starter holds 15 cards, so their first move is to discard (no draw).
  s.phase = "play";
  s.mustOpenWith = null;
  s.discardRefused = false;
  s.winner = null;
  s.takenFromDiscard = null;
  s.round += 1;
  log(s, `${s.round}. játszma indul – ${s.players[s.turn]!.name} kezd.`);
}

function takeFromHand(p: Player, ids: string[]): Card[] {
  if (new Set(ids).size !== ids.length) throw new RuleError("Ugyanaz a lap kétszer.");
  const cards = ids.map((id) => {
    const c = p.hand.find((h) => h.id === id);
    if (!c) throw new RuleError("Ez a lap nincs a kezedben.");
    return c;
  });
  return cards;
}

function removeFromHand(p: Player, ids: string[]) {
  p.hand = p.hand.filter((c) => !ids.includes(c.id));
}

function finishRound(s: GameState, winner: number) {
  const loser = s.players[1 - winner]!;
  const pts = loser.hand.reduce((a, c) => a + handValue(c), 0) * (loser.opened ? 1 : 2);
  s.players[winner]!.score += pts;
  s.lastRoundPoints = pts;
  s.winner = winner;
  s.status = "finished";
  s.starter = 1 - s.starter;
  log(s, `${s.players[winner]!.name} kiment! +${pts} pont.`);
}

export function applyAction(s: GameState, seat: number, a: Action, rand?: () => number): GameState {
  const me = s.players[seat];
  if (!me) throw new RuleError("Nem vagy ebben a szobában.");

  if (a.type === "ready") {
    if (s.status !== "lobby") throw new RuleError("A játék már elindult.");
    me.ready = !me.ready;
    if (s.players[0]?.ready && s.players[1]?.ready) deal(s, rand);
    return s;
  }
  if (a.type === "rematch") {
    if (s.status !== "finished") throw new RuleError("A játszma még tart.");
    me.rematch = true;
    if (s.players[0]?.rematch && s.players[1]?.rematch) deal(s, rand);
    return s;
  }

  if (s.status !== "playing") throw new RuleError("Nincs folyamatban játszma.");
  if (s.turn !== seat) throw new RuleError("Nem te következel.");

  switch (a.type) {
    case "drawStock": {
      if (s.phase !== "draw") throw new RuleError("Már húztál ebben a körben.");
      if (s.stock.length === 0) {
        if (s.discard.length <= 1) throw new RuleError("Elfogyott a pakli.");
        const top = s.discard.pop()!;
        s.stock = shuffle(s.discard, rand);
        s.discard = [top];
        log(s, "A dobott lapok újrakeverve a pakliba.");
      }
      me.hand.push(s.stock.pop()!);
      s.phase = "play";
      s.takenFromDiscard = null;
      log(s, `${me.name} húzott a pakliból.`);
      return s;
    }
    case "takeDiscard": {
      if (s.phase !== "draw") throw new RuleError("Már húztál ebben a körben.");
      if (s.discardRefused) throw new RuleError("Most a pakliból kell húznod.");
      const top = s.discard.pop();
      if (!top) throw new RuleError("Üres a dobott lapok pakli.");
      me.hand.push(top);
      s.phase = "play";
      s.takenFromDiscard = top.id;
      // From a player's own second turn on, an unopened player may only take the
      // discard if they open (≥51) with it in this same turn.
      s.mustOpenWith = me.firstTurnDone && !me.opened ? top.id : null;
      log(s, `${me.name} felvette a dobott lapot.`);
      return s;
    }
    case "open": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (me.opened) throw new RuleError("Már lepakoltál.");
      if (!a.groups.length) throw new RuleError("Nincs kiválasztott kombináció.");
      const all = a.groups.flat();
      takeFromHand(me, all);
      if (s.mustOpenWith && !all.includes(s.mustOpenWith))
        throw new RuleError("A felvett dobott lapot fel kell használnod a lepakolásban.");
      let total = 0;
      const melds: Meld[] = [];
      for (const g of a.groups) {
        const res = analyzeMeld(takeFromHand(me, g));
        if (!res.ok) throw new RuleError(res.reason);
        total += res.points;
        melds.push({ id: `m${++s.meldCounter}`, owner: seat, kind: res.kind, cards: res.ordered });
      }
      if (total < OPEN_MIN) throw new RuleError(`Az első lerakásnak legalább ${OPEN_MIN} pont kell (most ${total}).`);
      removeFromHand(me, all);
      s.melds.push(...melds);
      me.opened = true;
      s.mustOpenWith = null;
      log(s, `${me.name} lepakolt ${total} ponttal.`);
      if (me.hand.length === 0) finishRound(s, seat);
      return s;
    }
    case "meld": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (!me.opened) throw new RuleError(`Először legalább ${OPEN_MIN} ponttal kell lepakolnod.`);
      const res = analyzeMeld(takeFromHand(me, a.cardIds));
      if (!res.ok) throw new RuleError(res.reason);
      removeFromHand(me, a.cardIds);
      s.melds.push({ id: `m${++s.meldCounter}`, owner: seat, kind: res.kind, cards: res.ordered });
      log(s, `${me.name} új kombinációt rakott le.`);
      if (me.hand.length === 0) finishRound(s, seat);
      return s;
    }
    case "layoff": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (!me.opened) throw new RuleError("Hozzárakni csak lepakolás után lehet.");
      const meld = s.melds.find((m) => m.id === a.meldId);
      if (!meld) throw new RuleError("Nincs ilyen kombináció.");
      const res = analyzeMeld([...meld.cards, ...takeFromHand(me, a.cardIds)]);
      if (!res.ok || res.kind !== meld.kind) throw new RuleError("Ezek a lapok nem illenek ide.");
      removeFromHand(me, a.cardIds);
      meld.cards = res.ordered;
      log(s, `${me.name} hozzárakott egy kombinációhoz.`);
      if (me.hand.length === 0) finishRound(s, seat);
      return s;
    }
    case "discard": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (s.mustOpenWith) throw new RuleError(`A felvett lappal le kell pakolnod legalább ${OPEN_MIN} ponttal, vagy tedd vissza.`);
      if (a.cardId === s.takenFromDiscard) throw new RuleError("A most felvett lapot nem dobhatod vissza.");
      const [c] = takeFromHand(me, [a.cardId]);
      removeFromHand(me, [c.id]);
      s.discard.push(c);
      s.takenFromDiscard = null;
      s.discardRefused = false;
      me.firstTurnDone = true;
      log(s, `${me.name} eldobott egy lapot.`);
      if (me.hand.length === 0) {
        finishRound(s, seat);
      } else {
        s.turn = 1 - seat;
        s.phase = "draw";
      }
      return s;
    }
    case "returnDiscard": {
      if (s.phase !== "play" || !s.mustOpenWith) throw new RuleError("Nincs visszatehető lap.");
      const [c] = takeFromHand(me, [s.mustOpenWith]);
      removeFromHand(me, [c.id]);
      s.discard.push(c);
      s.mustOpenWith = null;
      s.takenFromDiscard = null;
      s.discardRefused = true;
      s.phase = "draw";
      log(s, `${me.name} visszatette a dobott lapot.`);
      return s;
    }
  }
}

// ---------------- Projection ----------------
export type PublicPlayer = { name: string; handCount: number; opened: boolean; score: number; ready: boolean; rematch: boolean };
export type PublicState = {
  code: string;
  status: GameState["status"];
  players: (PublicPlayer | null)[];
  melds: Meld[];
  discardTop: Card | null;
  discardCount: number;
  stockCount: number;
  turn: number;
  phase: GameState["phase"];
  round: number;
  winner: number | null;
  lastRoundPoints: number;
  revealedHands: Card[][] | null;
  /** Whether the player to move may freely take the discard (own first turn or already opened). */
  discardFree: boolean;
  mustOpen: boolean;
  discardRefused: boolean;
  log: string[];
  v: number;
};

/** Everything both players may see. Hands are only counted, never included (except after a round ends). */
export function toPublic(s: GameState): PublicState {
  return {
    code: s.code,
    status: s.status,
    players: s.players.map((p) =>
      p ? { name: p.name, handCount: p.hand.length, opened: p.opened, score: p.score, ready: p.ready, rematch: p.rematch } : null,
    ),
    melds: s.melds,
    discardTop: s.discard[s.discard.length - 1] ?? null,
    discardCount: s.discard.length,
    stockCount: s.stock.length,
    turn: s.turn,
    phase: s.phase,
    round: s.round,
    winner: s.winner,
    lastRoundPoints: s.lastRoundPoints,
    discardFree: !!s.players[s.turn] && (!s.players[s.turn]!.firstTurnDone || s.players[s.turn]!.opened),
    mustOpen: !!s.mustOpenWith,
    discardRefused: !!s.discardRefused,
    revealedHands: s.status === "finished" ? s.players.map((p) => p?.hand ?? []) : null,
    log: s.log,
    v: s.v,
  };
}
