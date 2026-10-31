// Pure, framework-free rummy rules. Runs on the server as the single source of truth.
export type Suit = "S" | "H" | "D" | "C" | "X"; // X = joker
export type Card = { id: string; suit: Suit; rank: number }; // joker rank 0, ace 1
export type MeldKind = "set" | "run";
export type Meld = { id: string; owner: number; kind: MeldKind; cards: Card[] };

export const OPEN_MIN = 51;
export const STARTER_HAND = 15;
export const SECOND_HAND = 14;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** Selectable match-ending penalty limits (per room). */
export const PENALTY_LIMITS = [200, 300, 500, 1000] as const;
export const DEFAULT_PENALTY_LIMIT = 500;
export const MAX_JOKERS_PER_MELD = 1;
const JOKER_LIMIT_MSG = "Egy kombinációban legfeljebb egy joker lehet.";
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
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function secureRandom() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0]! / 2 ** 32;
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
  if (jok > MAX_JOKERS_PER_MELD) return { ok: false, reason: JOKER_LIMIT_MSG };
  if (nat.length === 0 || jok > nat.length) return { ok: false, reason: "Túl sok joker." };
  const rank = nat[0]!.rank;
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
  if (jokers.length > MAX_JOKERS_PER_MELD) return { ok: false, reason: JOKER_LIMIT_MSG };
  if (nat.length === 0 || jokers.length > nat.length) return { ok: false, reason: "Túl sok joker." };
  if (nat.some((c) => c.suit !== nat[0]!.suit)) return { ok: false, reason: "Nem azonos színűek." };
  for (const aceHigh of [false, true]) {
    const mapped = nat.map((c) => ({ c, r: c.rank === 1 && aceHigh ? 14 : c.rank })).sort((a, b) => a.r - b.r);
    const rs = mapped.map((m) => m.r);
    if (new Set(rs).size !== rs.length) return { ok: false, reason: "Ismétlődő lap a sorozatban." };
    const min = rs[0]!;
    const max = rs[rs.length - 1]!;
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
      ordered.push(m ? m.c : jokers[j++]!);
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
  if (cards.length - nat.length > MAX_JOKERS_PER_MELD) return { ok: false, reason: JOKER_LIMIT_MSG };
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
  /** Opened during the current turn (used to detect going out "kézből"). */
  openedThisTurn?: boolean;
  requiredJokers?: string[];
};

export type GameState = {
  v: number;
  code: string;
  status: "lobby" | "playing" | "finished";
  /** 2–4 seats; null = empty seat. Length is the room capacity. */
  players: (Player | null)[];
  stock: Card[];
  discard: Card[];
  melds: Meld[];
  handi?: Card | null;
  retiredCards?: Card[];
  turn: number;
  phase: "draw" | "play";
  starter: number;
  round: number;
  winner: number | null;
  lastRoundPoints: number;
  /** Penalty points each seat received in the last round (null = empty seat). */
  lastRoundPenalties?: (number | null)[];
  /** Winner went out in one go ("kézből"), doubling penalties. */
  lastRoundHand?: boolean;
  takenFromDiscard: string | null;
  /** Card taken from discard that must be part of the 51-point opening this turn. */
  mustOpenWith?: string | null;
  /** Player put the discard back this turn and must draw from stock. */
  discardRefused?: boolean;
  meldCounter: number;
  log: string[];
  /** Match ends when any player's cumulative penalty reaches this. */
  maxPenalty?: number;
  /** The whole match is over (someone reached maxPenalty). */
  matchOver?: boolean;
};

export type Action =
  | { type: "ready" }
  | { type: "drawStock" }
  | { type: "takeDiscard" }
  | { type: "open"; groups: string[][] }
  | { type: "meld"; cardIds: string[] }
  | { type: "meldGroups"; groups: string[][] }
  | { type: "handiOut"; groups: string[][]; discardId: string }
  | { type: "layoff"; meldId: string; cardIds: string[] }
  | { type: "discard"; cardId: string }
  | { type: "returnDiscard" }
  | { type: "rematch" };

export class RuleError extends Error {}

export function newGame(code: string, size = 2, maxPenalty: number = DEFAULT_PENALTY_LIMIT): GameState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(size)));
  return {
    v: 0, code, status: "lobby", players: Array.from({ length: n }, () => null), stock: [], discard: [], melds: [],
    turn: 0, phase: "draw", starter: 0, round: 0, winner: null, lastRoundPoints: 0,
    takenFromDiscard: null, meldCounter: 0, log: [],
    maxPenalty: (PENALTY_LIMITS as readonly number[]).includes(maxPenalty) ? maxPenalty : DEFAULT_PENALTY_LIMIT, matchOver: false,
  };
}

function log(s: GameState, msg: string) {
  s.log = [...s.log, msg].slice(-8);
}

/** Occupied seats in turn order. */
export function seats(s: GameState): number[] {
  return s.players.flatMap((p, i) => (p ? [i] : []));
}

/** Next occupied seat after `seat` (clockwise). */
export function nextSeat(s: GameState, seat: number): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (seat + k) % n;
    if (s.players[i]) return i;
  }
  return seat;
}

export function deal(s: GameState, rand?: () => number) {
  if (seats(s).length < MIN_PLAYERS) throw new RuleError("Legalább két játékos kell.");
  if (!s.players[s.starter]) s.starter = nextSeat(s, s.starter);
  const deck = shuffle(makeDeck(), rand);
  s.players.forEach((p, i) => {
    if (!p) return;
    p.openedThisTurn = false;
    p.hand = deck.splice(0, i === s.starter ? STARTER_HAND : SECOND_HAND);
    p.opened = false;
    p.ready = false;
    p.rematch = false;
    p.firstTurnDone = false;
    p.requiredJokers = [];
  });
  s.discard = [];
  s.stock = deck;
  s.handi = s.stock.pop() ?? null;
  s.retiredCards = [];
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
  p.requiredJokers = (p.requiredJokers ?? []).filter((id) => !ids.includes(id));
}

function requireDiscard(p: Player, used: number, returned = 0) {
  if (p.hand.length - used + returned < 1) throw new RuleError("A záráshoz maradnia kell egy eldobható lapnak. Csak dobással lehet nyerni.");
}

function retireSets(s: GameState) {
  s.melds = s.melds.filter((m) => {
    const complete = m.kind === "set" && m.cards.length === 4 && m.cards.every((c) => c.suit !== "X") && new Set(m.cards.map((c) => c.suit)).size === 4;
    if (complete) s.retiredCards = [...(s.retiredCards ?? []), ...m.cards];
    return !complete;
  });
}

function replacesJoker(m: Meld, index: number, c: Card) {
  if (c.suit === "X") return false;
  const natural = m.cards.find((x) => x.suit !== "X");
  if (!natural) return false;
  if (m.kind === "set") return c.rank === natural.rank && !m.cards.some((x) => x.suit === c.suit);
  const naturalIndex = m.cards.indexOf(natural);
  const highAce = m.cards.at(-1)?.rank === 1;
  const position = (natural.rank === 1 && highAce ? 14 : natural.rank) + index - naturalIndex;
  return c.suit === natural.suit && c.rank === (position === 14 ? 1 : position);
}

/**
 * Handrömi scoring: every other player gets the value of the cards left in hand as
 * penalty points (doubled if they never opened). If the winner went out "kézből"
 * (opened and went out in the same turn), all penalties are doubled again.
 * Scores are cumulative penalties – lower is better.
 */
export function roundPenalties(s: GameState, winner: number): (number | null)[] {
  const hand = !!s.players[winner]?.openedThisTurn;
  return s.players.map((p, i) => {
    if (!p) return null;
    if (i === winner) return 0;
    const base = p.hand.reduce((a, c) => a + handValue(c), 0);
    return base * (p.opened ? 1 : 2) * (hand ? 2 : 1);
  });
}

function finishRound(s: GameState, winner: number) {
  const pen = roundPenalties(s, winner);
  pen.forEach((v, i) => { if (v != null) s.players[i]!.score += v; });
  s.lastRoundPenalties = pen;
  s.lastRoundHand = !!s.players[winner]?.openedThisTurn;
  s.lastRoundPoints = pen.reduce<number>((a, v) => a + (v ?? 0), 0);
  s.winner = winner;
  s.status = "finished";
  s.starter = nextSeat(s, s.starter);
  log(s, `${s.players[winner]!.name} kiment${s.lastRoundHand ? " kézből" : ""}!`);
  const limit = s.maxPenalty ?? DEFAULT_PENALTY_LIMIT;
  if (s.players.some((p) => p && p.score >= limit)) {
    s.matchOver = true;
    const champ = matchWinner(s);
    log(s, `Elérte valaki a ${limit} büntetőpontot – a játék véget ért. Győztes: ${champ != null ? s.players[champ]!.name : "–"}.`);
  }
}

/** Seat with the lowest cumulative penalty (ties: the round winner, then lowest seat). */
export function matchWinner(s: GameState): number | null {
  const sat = seats(s);
  if (!sat.length) return null;
  const min = Math.min(...sat.map((i) => s.players[i]!.score));
  const best = sat.filter((i) => s.players[i]!.score === min);
  return s.winner != null && best.includes(s.winner) ? s.winner : best[0]!;
}

export function applyAction(s: GameState, seat: number, a: Action, rand?: () => number): GameState {
  const me = s.players[seat];
  if (!me) throw new RuleError("Nem vagy ebben a szobában.");

  if (a.type === "ready") {
    if (s.status !== "lobby") throw new RuleError("A játék már elindult.");
    me.ready = !me.ready;
    const sat = seats(s);
    if (sat.length >= MIN_PLAYERS && sat.every((i) => s.players[i]!.ready)) deal(s, rand);
    return s;
  }
  if (a.type === "rematch") {
    if (s.status !== "finished") throw new RuleError("A játszma még tart.");
    me.rematch = true;
    if (seats(s).every((i) => s.players[i]!.rematch)) {
      if (s.matchOver) {
        // New match: penalties restart from zero.
        for (const i of seats(s)) s.players[i]!.score = 0;
        s.matchOver = false;
        s.round = 0;
      }
      deal(s, rand);
    }
    return s;
  }

  if (s.status !== "playing") throw new RuleError("Nincs folyamatban játszma.");
  if (a.type === "handiOut") {
    if (me.opened) throw new RuleError("A handi lap csak kézből záráshoz használható, lepakolás előtt.");
    if (!s.handi) throw new RuleError("Nincs handi lap.");
    const trial = structuredClone(s);
    const player = trial.players[seat];
    if (!player || !trial.handi) throw new RuleError("Nincs handi lap.");
    const handiId = trial.handi.id;
    if (!a.groups.flat().includes(handiId)) throw new RuleError("A handi lapot fel kell használnod a lepakolásban.");
    player.hand.push(trial.handi);
    trial.handi = null;
    trial.turn = seat;
    trial.phase = "play";
    trial.mustOpenWith = s.turn === seat ? (s.mustOpenWith ?? null) : null;
    trial.takenFromDiscard = s.turn === seat ? (s.takenFromDiscard ?? null) : null;
    applyAction(trial, seat, { type: "open", groups: a.groups });
    if (player.hand.length !== 1 || player.hand[0]?.id !== a.discardId) throw new RuleError("A handi lappal az összes lapot le kell pakolnod, egyetlen záródobás kivételével.");
    applyAction(trial, seat, { type: "discard", cardId: a.discardId });
    Object.assign(s, trial);
    return s;
  }
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
      requireDiscard(me, all.length);
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
      retireSets(s);
      me.opened = true;
      me.openedThisTurn = true;
      s.mustOpenWith = null;
      log(s, `${me.name} lepakolt ${total} ponttal.`);
      return s;
    }
    case "meldGroups": {
      const trial = structuredClone(s);
      for (const ids of a.groups) applyAction(trial, seat, { type: "meld", cardIds: ids });
      Object.assign(s, trial);
      return s;
    }
    case "meld": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (!me.opened) throw new RuleError(`Először legalább ${OPEN_MIN} ponttal kell lepakolnod.`);
      const res = analyzeMeld(takeFromHand(me, a.cardIds));
      if (!res.ok) throw new RuleError(res.reason);
      requireDiscard(me, a.cardIds.length);
      removeFromHand(me, a.cardIds);
      s.melds.push({ id: `m${++s.meldCounter}`, owner: seat, kind: res.kind, cards: res.ordered });
      retireSets(s);
      log(s, `${me.name} új kombinációt rakott le.`);
      return s;
    }
    case "layoff": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (!me.opened) throw new RuleError("Hozzárakni csak lepakolás után lehet.");
      const meld = s.melds.find((m) => m.id === a.meldId);
      if (!meld) throw new RuleError("Nincs ilyen kombináció.");
      const incoming = takeFromHand(me, a.cardIds);
      const cards = [...meld.cards];
      const returned: Card[] = [];
      const additions: Card[] = [];
      for (const c of incoming) {
        const index = cards.findIndex((x, i) => x.suit === "X" && replacesJoker({ ...meld, cards }, i, c));
        if (index < 0) additions.push(c);
        else {
          const joker = cards[index];
          if (joker) returned.push(joker);
          cards[index] = c;
        }
      }
      const res = analyzeMeld([...cards, ...additions]);
      if (!res.ok || res.kind !== meld.kind) throw new RuleError("Ezek a lapok nem illenek ide.");
      requireDiscard(me, incoming.length, returned.length);
      removeFromHand(me, a.cardIds);
      me.hand.push(...returned);
      me.requiredJokers = [...(me.requiredJokers ?? []), ...returned.map((c) => c.id)];
      meld.cards = res.ordered;
      retireSets(s);
      log(s, `${me.name} hozzárakott egy kombinációhoz.`);
      return s;
    }
    case "discard": {
      if (s.phase !== "play") throw new RuleError("Előbb húzz egy lapot.");
      if (s.mustOpenWith) throw new RuleError(`A felvett lappal le kell pakolnod legalább ${OPEN_MIN} ponttal, vagy tedd vissza.`);
      if (me.requiredJokers?.length) throw new RuleError("A kiváltott jokert még ebben a körben le kell raknod vagy be kell szúrnod, mielőtt dobsz.");
      if (a.cardId === s.takenFromDiscard) throw new RuleError("A most felvett lapot nem dobhatod vissza.");
      const c = takeFromHand(me, [a.cardId])[0]!;
      removeFromHand(me, [c.id]);
      s.discard.push(c);
      s.takenFromDiscard = null;
      s.discardRefused = false;
      me.firstTurnDone = true;
      log(s, `${me.name} eldobott egy lapot.`);
      if (me.hand.length === 0) {
        finishRound(s, seat);
      } else {
        me.openedThisTurn = false;
        s.turn = nextSeat(s, seat);
        s.phase = "draw";
      }
      return s;
    }
    case "returnDiscard": {
      if (s.phase !== "play" || !s.mustOpenWith) throw new RuleError("Nincs visszatehető lap.");
      const c = takeFromHand(me, [s.mustOpenWith])[0]!;
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
  handi: Card | null;
  turn: number;
  phase: GameState["phase"];
  round: number;
  winner: number | null;
  lastRoundPoints: number;
  lastRoundPenalties: (number | null)[] | null;
  lastRoundHand: boolean;
  revealedHands: Card[][] | null;
  maxPenalty: number;
  matchOver: boolean;
  matchWinner: number | null;
  /** Whether the player to move may freely take the discard (own first turn or already opened). */
  discardFree: boolean;
  mustOpen: boolean;
  /** The player to move is in their own first turn of the round. */
  firstTurn: boolean;
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
    handi: s.handi ?? null,
    turn: s.turn,
    phase: s.phase,
    round: s.round,
    winner: s.winner,
    lastRoundPoints: s.lastRoundPoints,
    discardFree: !!s.players[s.turn] && (!s.players[s.turn]!.firstTurnDone || s.players[s.turn]!.opened),
    mustOpen: !!s.mustOpenWith,
    firstTurn: !!s.players[s.turn] && !s.players[s.turn]!.firstTurnDone,
    discardRefused: !!s.discardRefused,
    lastRoundPenalties: s.lastRoundPenalties ?? null,
    lastRoundHand: !!s.lastRoundHand,
    revealedHands: s.status === "finished" ? s.players.map((p) => p?.hand ?? []) : null,
    log: s.log,
    v: s.v,
    maxPenalty: s.maxPenalty ?? DEFAULT_PENALTY_LIMIT,
    matchOver: !!s.matchOver,
    matchWinner: s.matchOver ? matchWinner(s) : null,
  };
}
