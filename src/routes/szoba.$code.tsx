import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDownUp, Check, Copy, Layers, Share2, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardBack, PlayingCard } from "@/components/rummy/PlayingCard";
import { analyzeMeld, OPEN_MIN, type Action, type Card, type PublicState } from "@/lib/rummy/engine";
import { getMyHand, joinRoom, playAction } from "@/lib/rummy/rummy.functions";
import { getSavedName, getSession, saveName, setSession, type Session } from "@/lib/rummy/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/szoba/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Szoba ${params.code} – Kétfős Römi Online` },
      { name: "description", content: `Csatlakozz a(z) ${params.code} römiszobához és játssz valós időben.` },
      { property: "og:title", content: `Römi meghívó – ${params.code}` },
      { property: "og:description", content: "Gyere, játsszunk egy kétfős römit!" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { code } = Route.useParams();
  const [mounted, setMounted] = useState(false);
  const [session, setSess] = useState<Session | null>(null);
  useEffect(() => {
    setSess(getSession(code));
    setMounted(true);
  }, [code]);
  if (!mounted) return <Centered>Betöltés…</Centered>;
  if (!session) return <JoinForm code={code} onJoined={setSess} />;
  return <Game code={code} session={session} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-muted-foreground">{children}</div>;
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (s: Session) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(getSavedName()), []);
  const join = async () => {
    if (!name.trim()) return toast.error("Add meg a neved!");
    saveName(name.trim());
    setBusy(true);
    const r = await joinRoom({ data: { code, name: name.trim() } }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return toast.error(r?.error ?? "Nem sikerült a kapcsolat.");
    const s = { token: r.data.token, seat: r.data.seat };
    setSession(code, s);
    onJoined(s);
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-5">
      <h1 className="text-gold text-center text-3xl font-bold">Meghívás römire</h1>
      <div className="felt-panel space-y-4 p-5">
        <p className="text-center text-sm text-muted-foreground">
          Szobakód: <span className="font-mono text-lg font-bold tracking-widest text-foreground">{code}</span>
        </p>
        <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="A neved" className="h-12 text-base" />
        <Button variant="gold" size="xl" className="w-full" onClick={join} disabled={busy}>
          {busy ? "Csatlakozás…" : "Csatlakozom"}
        </Button>
      </div>
      <Link to="/" className="text-center text-sm text-muted-foreground underline">Vissza a főoldalra</Link>
    </main>
  );
}

// ------------------------------------------------------------
type SortMode = "suit" | "rank";
const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, C: 2, D: 3, X: 4 };

function Game({ code, session }: { code: string; session: Session }) {
  const [pub, setPub] = useState<PublicState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hand, setHand] = useState<Card[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [takenFromDiscard, setTaken] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[][]>([]);
  const [busy, setBusy] = useState(false);
  const [rtStatus, setRtStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [online, setOnline] = useState<Set<number>>(new Set());
  const handV = useRef(-1);
  const pubV = useRef(-1);
  const seat = session.seat;
  const opp = 1 - seat;

  const applyHand = useCallback((h: Card[], v: number, taken: string | null) => {
    if (v < handV.current) return;
    handV.current = v;
    setHand(h);
    setTaken(taken);
    setOrder((prev) => {
      const ids = h.map((c) => c.id);
      const kept = prev.filter((id) => ids.includes(id));
      return [...kept, ...ids.filter((id) => !kept.includes(id))];
    });
    const ids = new Set(h.map((c) => c.id));
    setSelected((s) => s.filter((id) => ids.has(id)));
    setStaged((g) => (g.every((grp) => grp.every((id) => ids.has(id))) ? g : []));
  }, []);

  const refreshHand = useCallback(async () => {
    const r = await getMyHand({ data: { code, token: session.token } }).catch(() => null);
    if (r?.ok) applyHand(r.data.hand, r.data.v, r.data.takenFromDiscard);
    else if (r && !r.ok) toast.error(r.error);
  }, [code, session.token, applyHand]);

  const applyPub = useCallback(
    (p: PublicState | null) => {
      if (!p || p.v <= pubV.current) return;
      pubV.current = p.v;
      setPub(p);
      if (p.v > handV.current) refreshHand();
    },
    [refreshHand],
  );

  const fetchPub = useCallback(async () => {
    const { data, error } = await supabase.from("rummy_rooms").select("public_state").eq("code", code).maybeSingle();
    if (error) return;
    if (!data) return setNotFound(true);
    applyPub(data.public_state as unknown as PublicState);
  }, [code, applyPub]);

  // Realtime: room state + presence
  useEffect(() => {
    fetchPub();
    const ch = supabase
      .channel(`room-${code}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rummy_rooms", filter: `code=eq.${code}` }, (payload) => {
        applyPub((payload.new as { public_state: PublicState }).public_state);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRtStatus("online");
          fetchPub();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("offline");
      });
    const presence = supabase.channel(`presence-rummy-${code}`, { config: { presence: { key: String(seat) } } });
    presence
      .on("presence", { event: "sync" }, () => {
        setOnline(new Set(Object.keys(presence.presenceState()).map(Number)));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") presence.track({ seat, at: Date.now() });
      });
    // Fallback polling in case realtime drops (mobile networks)
    const poll = setInterval(fetchPub, 6000);
    const onVis = () => document.visibilityState === "visible" && fetchPub();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(ch);
      supabase.removeChannel(presence);
    };
  }, [code, seat, fetchPub, applyPub]);

  const act = async (action: Action) => {
    if (busy) return false;
    setBusy(true);
    const r = await playAction({ data: { code, token: session.token, action } }).catch(() => null);
    setBusy(false);
    if (!r) {
      toast.error("Nincs kapcsolat a szerverrel.");
      return false;
    }
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    applyHand(r.data.hand, r.data.v, r.data.takenFromDiscard);
    fetchPub();
    return true;
  };

  const byId = useMemo(() => new Map(hand.map((c) => [c.id, c])), [hand]);
  const stagedIds = useMemo(() => new Set(staged.flat()), [staged]);
  const visibleHand = order.map((id) => byId.get(id)).filter((c): c is Card => !!c && !stagedIds.has(c.id));

  if (notFound)
    return (
      <Centered>
        <div className="space-y-4 text-center">
          <p>Ez a szoba nem létezik.</p>
          <Button variant="gold" asChild><Link to="/">Főoldal</Link></Button>
        </div>
      </Centered>
    );
  if (!pub) return <Centered>Kapcsolódás a szobához…</Centered>;

  const me = pub.players[seat];
  const them = pub.players[opp];
  const myTurn = pub.status === "playing" && pub.turn === seat;
  const canPlay = myTurn && pub.phase === "play";
  const selCards = selected.map((id) => byId.get(id)!).filter(Boolean);
  const selAnalysis = selCards.length >= 3 ? analyzeMeld(selCards) : null;
  const stagedPoints = staged.reduce((a, g) => {
    const r = analyzeMeld(g.map((id) => byId.get(id)!));
    return a + (r.ok ? r.points : 0);
  }, 0);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const sortHand = (mode: SortMode) => {
    const sorted = [...hand].sort((a, b) =>
      mode === "suit"
        ? SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank
        : (a.rank || 99) - (b.rank || 99) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit],
    );
    setOrder(sorted.map((c) => c.id));
  };

  const onMeldButton = async () => {
    if (!selAnalysis?.ok) return toast.error(selAnalysis && !selAnalysis.ok ? selAnalysis.reason : "Válassz ki legalább 3 lapot.");
    if (!me?.opened) {
      setStaged((g) => [...g, selected]);
      setSelected([]);
      return;
    }
    if (await act({ type: "meld", cardIds: selected })) setSelected([]);
  };

  const onOpen = async () => {
    if (await act({ type: "open", groups: staged })) {
      setStaged([]);
      setSelected([]);
    }
  };

  const onDiscard = async () => {
    if (selected.length !== 1) return toast.error("Pontosan egy lapot válassz ki az eldobáshoz.");
    if (staged.length) setStaged([]);
    if (await act({ type: "discard", cardId: selected[0] })) setSelected([]);
  };

  const onMeldTap = async (meldId: string) => {
    if (!canPlay || !selected.length) return;
    if (!me?.opened) return toast.error("Hozzárakni csak lepakolás után lehet.");
    if (await act({ type: "layoff", meldId, cardIds: selected })) setSelected([]);
  };

  const share = async () => {
    const url = `${window.location.origin}/szoba/${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Kétfős Römi", text: `Gyere römizni! Kód: ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link másolva!");
      }
    } catch {
      /* user cancelled */
    }
  };

  const status = (
    <StatusBar code={code} rt={rtStatus} oppOnline={online.has(opp)} oppName={them?.name} round={pub.round} />
  );

  // ---------------- Lobby ----------------
  if (pub.status === "lobby") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-6">
        {status}
        <section className="felt-panel space-y-4 p-6 text-center">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">Szobakód</p>
          <p className="text-gold font-mono text-5xl font-bold tracking-[0.25em]">{code}</p>
          <div className="flex justify-center gap-2">
            <Button variant="felt" onClick={share}><Share2 /> Meghívás</Button>
            <Button
              variant="felt"
              onClick={() => navigator.clipboard?.writeText(code).then(() => toast.success("Kód másolva!"))}
            >
              <Copy /> Kód másolása
            </Button>
          </div>
        </section>
        <section className="felt-panel divide-y divide-border">
          {[0, 1].map((i) => {
            const p = pub.players[i];
            return (
              <div key={i} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <PresenceDot on={i === seat || online.has(i)} hidden={!p} />
                  <span className={cn("font-semibold", !p && "text-muted-foreground italic")}>
                    {p ? p.name : "Várakozás a második játékosra…"}
                    {i === seat && <span className="ml-2 text-xs text-muted-foreground">(te)</span>}
                  </span>
                </div>
                {p && (
                  <span className={cn("rounded-full px-3 py-1 text-xs font-bold", p.ready ? "bg-success text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {p.ready ? "Kész" : "Nem kész"}
                  </span>
                )}
              </div>
            );
          })}
        </section>
        <Button variant={me?.ready ? "felt" : "gold"} size="xl" onClick={() => act({ type: "ready" })} disabled={busy}>
          {me?.ready ? "Mégsem vagyok kész" : "Kész vagyok"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">A játék akkor indul, ha mindketten készen álltok.</p>
      </main>
    );
  }

  // ---------------- Table ----------------
  const oppMelds = pub.melds.filter((m) => m.owner === opp);
  const myMelds = pub.melds.filter((m) => m.owner === seat);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-2 px-2 pb-2 pt-2 sm:px-4">
      {status}

      {/* Opponent */}
      <section className={cn("felt-panel flex items-center justify-between gap-3 px-3 py-2", pub.turn === opp && pub.status === "playing" && "animate-turn")}>
        <div className="flex min-w-0 items-center gap-2">
          <PresenceDot on={online.has(opp)} />
          <div className="min-w-0">
            <p className="truncate font-bold">{them?.name ?? "Ellenfél"}</p>
            <p className="text-xs text-muted-foreground">
              {them?.handCount ?? 0} lap · {them?.score ?? 0} pont {them?.opened ? "· lepakolt" : ""}
            </p>
          </div>
        </div>
        <div className="flex -space-x-6">
          {Array.from({ length: Math.min(them?.handCount ?? 0, 10) }).map((_, i) => (
            <CardBack key={i} size="xs" />
          ))}
        </div>
      </section>

      {/* Table */}
      <section className="flex flex-1 flex-col gap-2 rounded-2xl border border-border p-2" style={{ minHeight: 0 }}>
        <MeldRow melds={oppMelds} label={`${them?.name ?? "Ellenfél"} kombinációi`} onTap={onMeldTap} active={canPlay && selected.length > 0} />

        <div className="flex items-center justify-center gap-6 py-2">
          <button
            type="button"
            onClick={() => act({ type: "drawStock" })}
            disabled={!(myTurn && pub.phase === "draw") || busy}
            className={cn("relative rounded-lg", myTurn && pub.phase === "draw" && "animate-turn")}
            aria-label="Húzás a pakliból"
          >
            <CardBack />
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 text-xs font-bold">{pub.stockCount}</span>
          </button>
          <button
            type="button"
            onClick={() => act({ type: "takeDiscard" })}
            disabled={!(myTurn && pub.phase === "draw") || !pub.discardTop || busy}
            className={cn("relative rounded-lg", myTurn && pub.phase === "draw" && pub.discardTop && "animate-turn")}
            aria-label="Dobott lap felvétele"
          >
            {pub.discardTop ? (
              <PlayingCard card={pub.discardTop} />
            ) : (
              <div className="flex h-[4.9rem] w-[3.4rem] items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground sm:h-[5.75rem] sm:w-16">üres</div>
            )}
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 text-xs font-bold">{pub.discardCount}</span>
          </button>
        </div>

        <MeldRow melds={myMelds} label="A te kombinációid" onTap={onMeldTap} active={canPlay && selected.length > 0} />
      </section>

      {/* Turn banner */}
      <div className={cn("rounded-xl px-3 py-2 text-center text-sm font-semibold", myTurn ? "bg-gold text-primary-foreground" : "bg-muted text-muted-foreground")}>
        {pub.status === "finished"
          ? "A játszma véget ért"
          : myTurn
            ? pub.phase === "draw"
              ? "Te jössz! Húzz a pakliból vagy vedd fel a dobott lapot."
              : me?.opened
                ? "Rakj le, rakj hozzá (koppints egy kombinációra), majd dobj el egy lapot."
                : `Lepakoláshoz gyűjts legalább ${OPEN_MIN} pontot, majd dobj el egy lapot.`
            : `${them?.name ?? "Az ellenfél"} következik…`}
      </div>

      {/* Staging for first meld */}
      {staged.length > 0 && (
        <section className="felt-panel space-y-2 p-2">
          <div className="flex items-center justify-between px-1 text-sm">
            <span className="font-semibold">Lepakolás előkészítése: <span className={stagedPoints >= OPEN_MIN ? "text-success" : "text-primary"}>{stagedPoints}</span> / {OPEN_MIN} pont</span>
            <button type="button" onClick={() => setStaged([])} className="text-muted-foreground" aria-label="Előkészítés törlése"><X className="size-5" /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {staged.map((g, i) => (
              <div key={i} className="flex -space-x-5">
                {g.map((id) => byId.get(id) && <PlayingCard key={id} card={byId.get(id)!} size="sm" />)}
              </div>
            ))}
          </div>
          <Button variant="gold" className="w-full" disabled={stagedPoints < OPEN_MIN || busy || !canPlay} onClick={onOpen}>
            <Check /> Lepakolás ({stagedPoints} pont)
          </Button>
        </section>
      )}

      {/* Actions */}
      <div className="grid grid-cols-4 gap-1.5">
        <Button variant="felt" size="xl" className="px-2 text-sm" onClick={onMeldButton} disabled={!canPlay || busy || selected.length < 3}>
          <Layers /> {me?.opened ? "Lerak" : "Előkészít"}
        </Button>
        <Button variant="gold" size="xl" className="px-2 text-sm" onClick={onDiscard} disabled={!canPlay || busy || selected.length !== 1}>
          <Trash2 /> Eldob
        </Button>
        <Button variant="felt" size="xl" className="px-2 text-sm" onClick={() => sortHand("suit")}>
          <ArrowDownUp /> Szín
        </Button>
        <Button variant="felt" size="xl" className="px-2 text-sm" onClick={() => sortHand("rank")}>
          <ArrowDownUp /> Érték
        </Button>
      </div>
      {selCards.length >= 3 && (
        <p className={cn("text-center text-xs", selAnalysis?.ok ? "text-success" : "text-destructive")}>
          {selAnalysis?.ok ? `Érvényes ${selAnalysis.kind === "set" ? "sor" : "sorozat"} · ${selAnalysis.points} pont` : selAnalysis?.reason}
        </p>
      )}

      {/* My hand */}
      <section className={cn("felt-panel px-2 pb-2 pt-5", myTurn && "animate-turn")}>
        <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span className="font-bold text-foreground">{me?.name} (te) · {me?.score ?? 0} pont</span>
          <span>{hand.length} lap {selected.length > 0 && `· ${selected.length} kijelölve`}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-1 pt-2">
          {visibleHand.map((c) => (
            <PlayingCard
              key={c.id}
              card={c}
              selected={selected.includes(c.id)}
              onClick={() => toggle(c.id)}
              className={cn("animate-deal", c.id === takenFromDiscard && "ring-2 ring-primary")}
            />
          ))}
        </div>
      </section>

      {pub.log.length > 0 && <p className="truncate px-1 text-center text-xs text-muted-foreground">{pub.log[pub.log.length - 1]}</p>}

      {pub.status === "finished" && (
        <FinishedOverlay pub={pub} seat={seat} busy={busy} onRematch={() => act({ type: "rematch" })} />
      )}
    </main>
  );
}

function StatusBar({ code, rt, oppOnline, oppName, round }: { code: string; rt: string; oppOnline: boolean; oppName?: string; round: number }) {
  return (
    <header className="flex items-center justify-between gap-2 px-1 text-xs">
      <Link to="/" className="text-gold font-display text-base font-bold">Römi</Link>
      <div className="flex items-center gap-3 text-muted-foreground">
        {round > 0 && <span>{round}. játszma</span>}
        <span className="font-mono font-bold tracking-widest text-foreground">{code}</span>
        <span className={cn("flex items-center gap-1", rt === "online" ? "text-success" : rt === "offline" ? "text-destructive" : "")}>
          {rt === "offline" ? <WifiOff className="size-3.5" /> : <Wifi className="size-3.5" />}
          {rt === "online" ? "Élő" : rt === "offline" ? "Nincs kapcsolat" : "Kapcsolódás"}
        </span>
        {oppName && (
          <span className="flex items-center gap-1">
            <PresenceDot on={oppOnline} />
            {oppOnline ? "Ellenfél online" : "Ellenfél offline"}
          </span>
        )}
      </div>
    </header>
  );
}

function PresenceDot({ on, hidden }: { on: boolean; hidden?: boolean }) {
  if (hidden) return <span className="inline-block size-2.5 rounded-full bg-muted" />;
  return <span className={cn("inline-block size-2.5 rounded-full", on ? "bg-success" : "bg-destructive")} />;
}

function MeldRow({ melds, label, onTap, active }: { melds: PublicState["melds"]; label: string; onTap: (id: string) => void; active: boolean }) {
  return (
    <div className="min-h-[3.75rem]">
      <p className="mb-1 px-1 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      {melds.length === 0 ? (
        <p className="px-1 text-xs italic text-muted-foreground/70">Még nincs lerakott lap</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {melds.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onTap(m.id)}
              className={cn("flex -space-x-5 rounded-lg p-1 transition", active && "ring-2 ring-primary/70 ring-dashed bg-primary/10")}
              aria-label="Hozzárakás ehhez a kombinációhoz"
            >
              {m.cards.map((c) => (
                <PlayingCard key={c.id} card={c} size="sm" />
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FinishedOverlay({ pub, seat, busy, onRematch }: { pub: PublicState; seat: number; busy: boolean; onRematch: () => void }) {
  const won = pub.winner === seat;
  const winnerName = pub.winner != null ? pub.players[pub.winner]?.name : "";
  const opp = 1 - seat;
  const oppHand = pub.revealedHands?.[opp] ?? [];
  const meReady = pub.players[seat]?.rematch;
  const oppReady = pub.players[opp]?.rematch;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="felt-panel w-full max-w-sm space-y-5 p-6 text-center animate-deal">
        <h2 className="text-gold text-3xl font-bold">{won ? "Nyertél!" : `${winnerName} nyert`}</h2>
        <p className="text-muted-foreground">+{pub.lastRoundPoints} pont a győztesnek</p>
        <div className="flex justify-around rounded-xl bg-muted/50 p-3">
          {pub.players.map((p, i) => (
            <div key={i}>
              <p className="text-sm text-muted-foreground">{p?.name}{i === seat ? " (te)" : ""}</p>
              <p className="font-display text-2xl font-bold">{p?.score ?? 0}</p>
            </div>
          ))}
        </div>
        {oppHand.length > 0 && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Az ellenfél lapjai</p>
            <div className="flex flex-wrap justify-center gap-1">
              {oppHand.map((c) => <PlayingCard key={c.id} card={c} size="xs" />)}
            </div>
          </div>
        )}
        <Button variant="gold" size="xl" className="w-full" onClick={onRematch} disabled={busy || meReady}>
          {meReady ? (oppReady ? "Indul…" : "Várakozás az ellenfélre…") : oppReady ? "Az ellenfél kér visszavágót – Mehet!" : "Visszavágó"}
        </Button>
        <Link to="/" className="block text-sm text-muted-foreground underline">Kilépés a főoldalra</Link>
      </div>
    </div>
  );
}
