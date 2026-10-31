import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { analyzeMeld, applyAction, DEFAULT_PENALTY_LIMIT, newGame, PENALTY_LIMITS, RuleError, toPublic, type Action, type Card, type GameState } from "./engine";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(5)), (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function load(code: string): Promise<GameState | null> {
  const db = await admin();
  const { data, error } = await db.from("rummy_secrets").select("secret_state").eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.secret_state as unknown as GameState) ?? null;
}

/** Optimistic-locked write: secret state is authoritative, the room row is a public projection. */
async function save(prev: number, s: GameState): Promise<boolean> {
  const db = await admin();
  s.v = prev + 1;
  const { data, error } = await db
    .from("rummy_secrets")
    .update({ secret_state: s as never })
    .eq("code", s.code)
    .eq("secret_state->>v", String(prev))
    .select("code");
  if (error) throw new Error(error.message);
  if (!data?.length) return false;
  await db
    .from("rummy_rooms")
    .update({ public_state: toPublic(s) as never, version: s.v, status: s.status, updated_at: new Date().toISOString() })
    .eq("code", s.code)
    .lt("version", s.v);
  return true;
}

async function mutate(code: string, fn: (s: GameState) => void): Promise<GameState> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await load(code);
    if (!s) throw new RuleError("Nem létezik ilyen szoba.");
    const prev = s.v;
    fn(s);
    if (await save(prev, s)) return s;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));
  }
  throw new RuleError("A szoba épp foglalt, próbáld újra.");
}

function seatOf(s: GameState, token: string) {
  const i = s.players.findIndex((p) => p?.token === token);
  if (i < 0) throw new RuleError("Érvénytelen játékos azonosító.");
  return i;
}

function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn().then(
    (data) => ({ ok: true as const, data }),
    (e) => {
      if (e instanceof RuleError) return { ok: false as const, error: e.message };
      console.error(e);
      return { ok: false as const, error: "Szerverhiba. Próbáld újra." };
    },
  );
}

const nameSchema = z.string().trim().min(1).max(20);
const codeSchema = z.string().trim().toUpperCase().length(5);

export const createRoom = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ name: nameSchema, size: z.number().int().min(2).max(4).default(2), maxPenalty: z.number().int().refine((n) => (PENALTY_LIMITS as readonly number[]).includes(n)).default(DEFAULT_PENALTY_LIMIT) }).parse(d))
  .handler(({ data }) =>
    wrap(async () => {
      const db = await admin();
      for (let i = 0; i < 6; i++) {
        const code = randomCode();
        const token = randomToken();
        const s = newGame(code, data.size, data.maxPenalty);
        s.players[0] = { name: data.name, token, hand: [], opened: false, score: 0, ready: false, rematch: false };
        s.v = 1;
        const { error } = await db
          .from("rummy_rooms")
          .insert({ code, public_state: toPublic(s) as never, version: 1, status: "lobby" });
        if (error) continue;
        const { error: e2 } = await db.from("rummy_secrets").insert({ code, secret_state: s as never });
        if (e2) throw new Error(e2.message);
        return { code, token, seat: 0 };
      }
      throw new Error("Nem sikerült szobát létrehozni.");
    }),
  );

export const joinRoom = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: codeSchema, name: nameSchema }).parse(d))
  .handler(({ data }) =>
    wrap(async () => {
      const token = randomToken();
      let seat = -1;
      await mutate(data.code, (s) => {
        if (s.status !== "lobby") throw new RuleError("A játék már elindult ebben a szobában.");
        seat = s.players.findIndex((p) => p === null);
        if (seat < 0) throw new RuleError("A szoba megtelt.");
        s.players[seat] = { name: data.name, token, hand: [], opened: false, score: 0, ready: false, rematch: false };
        s.log = [...s.log, `${data.name} csatlakozott.`].slice(-8);
      });
      return { code: data.code, token, seat };
    }),
  );

/** Returns only the caller's own hand. */
export const getMyHand = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: codeSchema, token: z.string().min(10) }).parse(d))
  .handler(({ data }) =>
    wrap(async () => {
      const s = await load(data.code);
      if (!s) throw new RuleError("Nem létezik ilyen szoba.");
      const seat = seatOf(s, data.token);
      return { seat, hand: s.players[seat]?.hand ?? [], requiredJokers: s.players[seat]?.requiredJokers ?? [], v: s.v, takenFromDiscard: s.turn === seat ? s.takenFromDiscard : null };
    }),
  );

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("rematch") }),
  z.object({ type: z.literal("drawStock") }),
  z.object({ type: z.literal("takeDiscard") }),
  z.object({ type: z.literal("open"), groups: z.array(z.array(z.string()).min(3).max(13)).min(1).max(6) }),
  z.object({ type: z.literal("meld"), cardIds: z.array(z.string()).min(3).max(13) }),
  z.object({ type: z.literal("meldGroups"), groups: z.array(z.array(z.string()).min(3).max(13)).min(1).max(6) }),
  z.object({ type: z.literal("handiOut"), groups: z.array(z.array(z.string()).min(3).max(13)).min(1).max(6), discardId: z.string() }),
  z.object({ type: z.literal("layoff"), meldId: z.string(), cardIds: z.array(z.string()).min(1).max(10) }),
  z.object({ type: z.literal("discard"), cardId: z.string() }),
  z.object({ type: z.literal("returnDiscard") }),
]);

export const playAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: codeSchema, token: z.string().min(10), action: actionSchema }).parse(d),
  )
  .handler(({ data }) =>
    wrap(async () => {
      let seat = 0;
      const s = await mutate(data.code, (st) => {
        seat = seatOf(st, data.token);
        applyAction(st, seat, data.action as Action);
      });
      return { hand: s.players[seat]?.hand ?? [], requiredJokers: s.players[seat]?.requiredJokers ?? [], v: s.v, takenFromDiscard: s.turn === seat ? s.takenFromDiscard : null };
    }),
  );

/** Read-only preparation checks; the browser never decides meld validity. */
export const checkPreparation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: codeSchema, token: z.string().min(10), groups: z.array(z.array(z.string()).max(13)).max(7) }).parse(d))
  .handler(({ data }) => wrap(async () => {
    const s = await load(data.code);
    if (!s) throw new RuleError("Nem létezik ilyen szoba.");
    const seat = seatOf(s, data.token);
    const cards = [...(s.players[seat]?.hand ?? []), ...(s.handi ? [s.handi] : [])];
    return data.groups.map((group) => {
      const found = group.map((id) => cards.find((c) => c.id === id));
      if (new Set(group).size !== group.length || found.some((c) => !c)) return { ok: false as const, reason: "Ez a lap nincs a kezedben." };
      return analyzeMeld(found.filter((c): c is Card => !!c));
    });
  }));
