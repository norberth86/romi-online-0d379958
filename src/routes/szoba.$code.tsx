import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDownUp, Check, Copy, Layers, Pencil, Share2, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardBack, PlayingCard } from "@/components/rummy/PlayingCard";
import { OPEN_MIN, type Action, type Analysis, type Card, type PublicState } from "@/lib/rummy/engine";
import { checkPreparation, getMyHand, joinRoom, playAction } from "@/lib/rummy/rummy.functions";
import { retainPreparation } from "@/lib/rummy/preparation";
import { getSavedName, getSession, saveName, setSession, type Session } from "@/lib/rummy/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/szoba/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Szoba ${params.code} – Römi Online` },
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
    if (!name.trim()) return void toast.error("Add meg a neved!");
    saveName(name.trim());
    setBusy(true);
    const r = await joinRoom({ data: { code, name: name.trim() } }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return void toast.error(r?.error ?? "Nem sikerült a kapcsolat.");
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
const SUIT_ORDER: Record<Card["suit"], number> = { S: 0, H: 1, C: 2, D: 3, X: 4 };

function Game({ code, session }: { code: string; session: Session }) {
  const seat = session.seat;
  const [pub, setPub] = useState<PublicState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hand, setHand] = useState<Card[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [takenFromDiscard, setTaken] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[][]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [handiSelected, setHandiSelected] = useState(false);
  const [requiredJokers, setRequiredJokers] = useState<string[]>([]);
  const preparationKey = pub ? `rummy:prep:${code}:${seat}:${pub.round}` : null;
  const restoredKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rtStatus, setRtStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [online, setOnline] = useState<Set<number>>(new Set());
  const handV = useRef(-1);
  const pubV = useRef(-1);

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
  }, []);

  useEffect(() => {
    if (!preparationKey || !pub || handV.current < pub.v) return;
    const available = [...hand.map((c) => c.id), ...(pub.handi ? [pub.handi.id] : [])];
    if (restoredKey.current !== preparationKey) {
      let saved: string[][] = [];
      try {
        const raw: unknown = JSON.parse(localStorage.getItem(preparationKey) ?? "[]");
        if (Array.isArray(raw) && raw.every((g) => Array.isArray(g) && g.every((id) => typeof id === "string"))) saved = raw;
      } catch { /* unavailable storage */ }
      restoredKey.current = preparationKey;
      setStaged(retainPreparation(saved, available));
      setEditing(null);
      setHandiSelected(false);
    } else setStaged((g) => retainPreparation(g, available));
  }, [preparationKey, hand, pub]);

  useEffect(() => {
    if (preparationKey && restoredKey.current === preparationKey) {
      try { localStorage.setItem(preparationKey, JSON.stringify(staged)); } catch { /* unavailable storage */ }
    }
  }, [staged, preparationKey]);

  useEffect(() => {
    setAnalyses([]);
    let active = true;
    const groups = [...staged, selected];
    if (!groups.some((g) => g.length)) return;
    const timer = setTimeout(() => {
      checkPreparation({ data: { code, token: session.token, groups } }).then((r) => {
        if (active && r.ok) setAnalyses(r.data);
      }).catch(() => {});
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [code, session.token, staged, selected, hand]);

  const refreshHand = useCallback(async () => {
    const r = await getMyHand({ data: { code, token: session.token } }).catch(() => null);
    if (r?.ok) { applyHand(r.data.hand, r.data.v, r.data.takenFromDiscard); setRequiredJokers(r.data.requiredJokers); }
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
    setRequiredJokers(r.data.requiredJokers);
    fetchPub();
    return true;
  };

  const byId = useMemo(() => new Map([...hand, ...(pub?.handi ? [pub.handi] : [])].map((c) => [c.id, c])), [hand, pub?.handi]);
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
  const opps = pub.players.flatMap((p, i) => (p && i !== seat ? [{ p, i }] : []));
  const turnName = pub.players[pub.turn]?.name;
  const myTurn = pub.status === "playing" && pub.turn === seat;
  const canPlay = myTurn && pub.phase === "play";
  const selCards = selected.map((id) => byId.get(id)).filter((c): c is Card => !!c);
  const selAnalysis = analyses[staged.length];
  const stagedPoints = analyses.slice(0, staged.length).reduce((a, r) => a + (r.ok ? r.points : 0), 0);
  const stagedValid = staged.length > 0 && analyses.length === staged.length + 1 && analyses.slice(0, staged.length).every((r) => r.ok);
  const handiPrepared = !!pub.handi && stagedIds.has(pub.handi.id);
  const closingCard = hand.filter((c) => !stagedIds.has(c.id));

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
    if (!selAnalysis?.ok) return void toast.error(selAnalysis && !selAnalysis.ok ? selAnalysis.reason : "Válassz ki legalább 3 lapot.");
    setStaged((g) => editing === null ? [...g, selected] : g.map((group, i) => i === editing ? selected : group));
    setEditing(null);
    setSelected([]);
  };

  const onOpen = async () => {
    const action: Action = handiPrepared && closingCard.length === 1 && closingCard[0]
      ? { type: "handiOut", groups: staged, discardId: closingCard[0].id }
      : me?.opened ? { type: "meldGroups", groups: staged } : { type: "open", groups: staged };
    if (await act(action)) {
      setStaged([]);
      setSelected([]);
    }
  };

  const onDiscard = async () => {
    if (selected.length !== 1) return void toast.error("Pontosan egy lapot válassz ki az eldobáshoz.");
    const cardId = selected[0];
    if (cardId && await act({ type: "discard", cardId })) setSelected([]);
  };

  const onMeldTap = async (meldId: string) => {
    if (!canPlay || !selected.length) return;
    if (!me?.opened) return void toast.error("Hozzárakni csak lepakolás után lehet.");
    if (await act({ type: "layoff", meldId, cardIds: selected })) setSelected([]);
  };

  const share = async () => {
    const url = `${window.location.origin}/szoba/${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Römi Online", text: `Gyere römizni! Kód: ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link másolva!");
      }
    } catch {
      /* user cancelled */
    }
  };

  const status = (
    <StatusBar code={code} rt={rtStatus} onlineCount={opps.filter((o) => online.has(o.i)).length} oppCount={opps.length} round={pub.round} />
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
          {pub.players.map((_, i) => {
            const p = pub.players[i];
            return (
              <div key={i} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <PresenceDot on={i === seat || online.has(i)} hidden={!p} />
                  <span className={cn("font-semibold", !p && "text-muted-foreground italic")}>
                    {p ? p.name : "Várakozás egy játékosra…"}
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
        <p className="text-center text-sm text-muted-foreground">
          {pub.players.length} fős szoba, a játék {pub.maxPenalty} büntetőpontig tart. A játék akkor indul, ha legalább ketten vagytok és minden csatlakozott játékos kész.
        </p>
      </main>
    );
  }

  // ---------------- Table ----------------
  const myMelds = pub.melds.filter((m) => m.owner === seat);

  const bannerText = pub.status === "finished"
    ? "A játszma véget ért"
    : myTurn
      ? pub.phase === "draw"
        ? pub.discardRefused
          ? "Húzz egy lapot a pakliból."
          : pub.discardFree
            ? "Te jössz! Húzz a pakliból vagy vedd fel a dobott lapot."
            : `Te jössz! A dobott lapot csak akkor veheted fel, ha vele együtt legalább ${OPEN_MIN} ponttal lepakolsz.`
        : pub.firstTurn && pub.discardCount === 0
          ? "Te kezdesz! Válassz ki és dobj el egy lapot (lepakolhatsz is, ha megvan az 51 pont)."
          : pub.mustOpen
            ? `Pakolj le legalább ${OPEN_MIN} ponttal a felvett (keretezett) lappal együtt, vagy tedd vissza.`
            : requiredJokers.length > 0
              ? "A kiváltott jokert még ebben a körben rakd le vagy szúrd be, majd dobj egy lapot."
              : me?.opened
                ? "Rakj le, rakj hozzá (koppints egy kombinációra), majd dobj el egy lapot."
                : `Lepakoláshoz gyűjts legalább ${OPEN_MIN} pontot, majd dobj el egy lapot.`
      : `${turnName ?? "A következő játékos"} következik…`;

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col gap-1.5 overflow-hidden px-2 py-1.5 sm:px-4">
      {status}

      {/* Opponents */}
      <div className={cn("grid shrink-0 gap-1.5", opps.length === 3 ? "grid-cols-3" : opps.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {opps.map(({ p, i }) => (
          <section key={i} className={cn("felt-panel flex items-center justify-between gap-2 px-2.5 py-1.5", pub.turn === i && pub.status === "playing" && "animate-turn")}>
            <div className="flex min-w-0 items-center gap-2">
              <PresenceDot on={online.has(i)} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.handCount} lap · {p.score}/{pub.maxPenalty} bp {p.opened ? "· lepakolt" : ""}
                </p>
              </div>
            </div>
            {opps.length === 1 && (
              <div className="flex -space-x-6">
                {Array.from({ length: Math.min(p.handCount, 10) }).map((_, k) => (
                  <CardBack key={k} size="xs" />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Table – the only part that scrolls, so the hand and buttons always stay on screen */}
      <section className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain rounded-2xl border border-border p-1.5">
        {opps.map(({ p, i }) => (
          <MeldRow key={i} melds={pub.melds.filter((m) => m.owner === i)} label={`${p.name} kombinációi`} onTap={onMeldTap} active={canPlay && selected.length > 0} />
        ))}

        <div className="flex shrink-0 items-center justify-center gap-4 py-3 sm:gap-8">
          {pub.handi && <Button variant="ghost" className="card-slot-md relative h-auto shrink-0 p-0 hover:bg-transparent" style={{ width: "calc(var(--card-md-w) * 1.43)", height: "calc(var(--card-md-w) * 1.43)" }} aria-label="Handi lap előkészítése" disabled={me?.opened || busy || stagedIds.has(pub.handi.id)} onClick={() => {
            if (!pub.handi) return;
            toggle(pub.handi.id);
            setHandiSelected((v) => !v);
          }}><PlayingCard card={pub.handi} selected={handiSelected} className="rotate-90" /><span className="absolute -bottom-5 text-xs font-bold text-primary">Handi</span></Button>}
          <Button variant="ghost"
            type="button"
            onClick={() => act({ type: "drawStock" })}
            disabled={!(myTurn && pub.phase === "draw") || busy}
            className={cn("relative h-auto rounded-lg p-0 hover:bg-transparent", myTurn && pub.phase === "draw" && "animate-turn")}
            aria-label="Húzás a pakliból"
          >
            <CardBack />
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 text-xs font-bold">{pub.stockCount}</span>
          </Button>
          <Button variant="ghost"
            type="button"
            onClick={() => act({ type: "takeDiscard" })}
            disabled={!(myTurn && pub.phase === "draw") || !pub.discardTop || pub.discardRefused || busy}
            className={cn("relative h-auto rounded-lg p-0 hover:bg-transparent", myTurn && pub.phase === "draw" && pub.discardTop && "animate-turn")}
            aria-label="Dobott lap felvétele"
          >
            {pub.discardTop ? (
              <PlayingCard card={pub.discardTop} />
            ) : (
              <div className="card-md flex items-center justify-center rounded-lg border-2 border-dashed border-border text-muted-foreground">üres</div>
            )}
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 text-xs font-bold">{pub.discardCount}</span>
          </Button>
        </div>

        <MeldRow melds={myMelds} label="A te kombinációid" onTap={onMeldTap} active={canPlay && selected.length > 0} />
      </section>

      {/* Turn banner */}
      <div className={cn("shrink-0 rounded-xl px-3 py-1.5 text-center text-sm font-semibold leading-snug", myTurn ? "bg-gold text-primary-foreground" : "bg-muted text-muted-foreground")}>
        {bannerText}
      </div>

      {canPlay && pub.mustOpen && (
        <Button variant="felt" className="w-full shrink-0" disabled={busy} onClick={() => act({ type: "returnDiscard" })}>
          <X /> Visszateszem a dobott lapot
        </Button>
      )}

      {/* Preparation: compact, scrolls sideways instead of pushing the hand off screen */}
      {staged.length > 0 && (
        <section className="felt-panel shrink-0 space-y-1.5 p-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate px-1 text-sm font-semibold">Előkészítés: {stagedPoints}{!me?.opened && ` / ${OPEN_MIN}`} pont</span>
            <Button variant="gold" size="sm" disabled={!stagedValid || (!me?.opened && stagedPoints < OPEN_MIN) || busy || (handiPrepared ? me?.opened || closingCard.length !== 1 : !canPlay)} onClick={onOpen}>
              <Check /> {handiPrepared ? "Handi" : me?.opened ? "Lerakás" : "Lepakolás"}
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => { setStaged([]); setEditing(null); }} aria-label="Előkészítés törlése"><X /></Button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {staged.map((g, i) => (
              <div key={i} className={cn("flex shrink-0 flex-col gap-1 rounded-md border border-border p-1", editing === i && "ring-2 ring-primary", analyses[i] && !analyses[i].ok && "border-destructive")}>
                <div className="flex gap-0.5">{g.map((id) => {
                  const card = byId.get(id);
                  return card ? <PlayingCard key={id} card={card} size="sm" onClick={() => {
                    setStaged((groups) => groups.map((group, j) => j === i ? group.filter((x) => x !== id) : group));
                    setSelected((ids) => ids.filter((x) => x !== id));
                    if (id === pub.handi?.id) setHandiSelected(false);
                  }} /> : null;
                })}</div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-muted-foreground">{analyses[i]?.ok ? `${analyses[i].points} p` : "Hiányos"}</span>
                  <div className="flex">
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`${i + 1}. előkészítés módosítása`} onClick={() => { setEditing(i); setSelected(g); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`${i + 1}. előkészítés törlése`} onClick={() => { setStaged((groups) => groups.filter((_, j) => j !== i)); setEditing(null); setSelected([]); }}><X /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Actions */}
      <div className="grid shrink-0 grid-cols-4 gap-1.5">
        <Button variant="felt" className="px-1 text-sm" onClick={onMeldButton} disabled={pub.status !== "playing" || busy || selected.length < 3}>
          <Layers /> {editing !== null ? "Mentés" : "Előkészít"}
        </Button>
        <Button variant="gold" className="px-1 text-sm" onClick={onDiscard} disabled={!canPlay || busy || selected.length !== 1 || pub.mustOpen || requiredJokers.length > 0 || selected[0] === pub.handi?.id}>
          <Trash2 /> Eldob
        </Button>
        <Button variant="felt" className="px-1 text-sm" onClick={() => sortHand("suit")}>
          <ArrowDownUp /> Szín
        </Button>
        <Button variant="felt" className="px-1 text-sm" onClick={() => sortHand("rank")}>
          <ArrowDownUp /> Érték
        </Button>
      </div>

      {/* My hand */}
      <section className={cn("felt-panel shrink-0 px-1.5 pb-1.5 pt-1", myTurn && "animate-turn")}>
        <div className="mb-1 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span className="truncate font-bold text-foreground">{me?.name} (te) · {me?.score ?? 0}/{pub.maxPenalty} bp</span>
          {selCards.length >= 3 ? (
            <span className={cn("truncate font-semibold", selAnalysis?.ok ? "text-success" : "text-destructive")}>
              {selAnalysis?.ok ? `${selAnalysis.kind === "set" ? "Sor" : "Sorozat"} · ${selAnalysis.points} pont` : selAnalysis?.reason ?? "Ellenőrzés…"}
            </span>
          ) : (
            <span className="shrink-0">{hand.length} lap{selected.length > 0 && ` · ${selected.length} kijelölve`}</span>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-1 pt-2">
          {visibleHand.map((c) => (
            <PlayingCard
              key={c.id}
              card={c}
              selected={selected.includes(c.id)}
              onClick={() => toggle(c.id)}
              className={cn("animate-deal", (c.id === takenFromDiscard || requiredJokers.includes(c.id)) && "outline-[3px] outline-solid outline-offset-2 outline-primary")}
            />
          ))}
        </div>
      </section>

      {pub.log.length > 0 && <p className="shrink-0 truncate px-1 text-center text-xs text-muted-foreground">{pub.log[pub.log.length - 1]}</p>}

      {pub.status === "finished" && (
        <FinishedOverlay pub={pub} seat={seat} busy={busy} onRematch={() => act({ type: "rematch" })} />
      )}
    </main>
  );
}

function StatusBar({ code, rt, onlineCount, oppCount, round }: { code: string; rt: string; onlineCount: number; oppCount: number; round: number }) {
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
        {oppCount > 0 && (
          <span className="flex items-center gap-1">
            <PresenceDot on={onlineCount === oppCount} />
            {oppCount === 1 ? (onlineCount ? "Ellenfél online" : "Ellenfél offline") : `${onlineCount}/${oppCount} ellenfél online`}
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
    <div className="shrink-0">
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
              className={cn("flex -space-x-[calc(var(--card-sm-w)*0.42)] rounded-lg p-1 transition", active && "ring-2 ring-primary/70 ring-dashed bg-primary/10")}
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
  const meReady = pub.players[seat]?.rematch;
  const waiting = pub.players.filter((p) => p && !p.rematch).length;
  const leader = Math.min(...pub.players.flatMap((p) => (p ? [p.score] : [])));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <div className="felt-panel my-auto max-h-full w-full max-w-sm space-y-4 overflow-y-auto p-6 text-center animate-deal">
        {pub.matchOver && (
          <div className="rounded-xl bg-gold px-3 py-2 text-primary-foreground">
            <p className="text-xs font-semibold uppercase tracking-widest">Vége a játéknak – elérte valaki a {pub.maxPenalty} pontot</p>
            <p className="font-display text-2xl font-bold">{pub.matchWinner === seat ? "Te nyertél!" : `${pub.matchWinner != null ? pub.players[pub.matchWinner]?.name : ""} nyert`}</p>
          </div>
        )}
        <h2 className="text-gold text-3xl font-bold">{won ? "Kimentél!" : `${winnerName} kiment`}</h2>
        {pub.lastRoundHand && <p className="text-sm font-semibold text-primary">Kézből ment ki – dupla büntetés!</p>}
        <div className="divide-y divide-border rounded-xl bg-muted/50">
          {pub.players.map((p, i) =>
            p ? (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={cn(p.score === leader && "font-bold text-primary")}>{p.name}{i === seat ? " (te)" : ""}</span>
                <span className="text-muted-foreground">
                  +{pub.lastRoundPenalties?.[i] ?? 0} → <span className="font-display text-lg font-bold text-foreground">{p.score}</span>
                </span>
              </div>
            ) : null,
          )}
        </div>
        <p className="text-xs text-muted-foreground">Büntetőpontok – a kevesebb a jobb. Határ: {pub.maxPenalty} pont.</p>
        {pub.players.map((p, i) =>
          p && i !== seat && (pub.revealedHands?.[i]?.length ?? 0) > 0 ? (
            <div key={i}>
              <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{p.name} lapjai</p>
              <div className="flex flex-wrap justify-center gap-1">
                {pub.revealedHands?.[i]?.map((c) => <PlayingCard key={c.id} card={c} size="xs" />)}
              </div>
            </div>
          ) : null,
        )}
        <Button variant="gold" size="xl" className="w-full" onClick={onRematch} disabled={busy || meReady}>
          {meReady ? (waiting ? `Várakozás (${waiting})…` : "Indul…") : pub.matchOver ? "Új játék (pontok nullázása)" : "Új játszma"}
        </Button>
        <Link to="/" className="block text-sm text-muted-foreground underline">Kilépés a főoldalra</Link>
      </div>
    </div>
  );
}
