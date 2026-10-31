import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayingCard } from "@/components/rummy/PlayingCard";
import { DEFAULT_PENALTY_LIMIT, PENALTY_LIMITS } from "@/lib/rummy/engine";
import { createRoom, joinRoom } from "@/lib/rummy/rummy.functions";
import { getSavedName, saveName, setSession } from "@/lib/rummy/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Römi Online – játssz két telefonon" },
      { name: "description", content: "Kétszemélyes magyar römi valós időben, két külön telefonon. Hozz létre szobát, oszd meg a kódot, és játsszatok!" },
      { property: "og:title", content: "Römi Online" },
      { property: "og:description", content: "Kétszemélyes magyar römi valós időben, két külön telefonon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [size, setSize] = useState(2);
  const [maxPenalty, setMaxPenalty] = useState<number>(DEFAULT_PENALTY_LIMIT);

  useEffect(() => {
    setName(getSavedName());
    const c = new URLSearchParams(window.location.search).get("kod");
    if (c) setCode(c.toUpperCase());
  }, []);

  const needName = () => {
    if (!name.trim()) {
      toast.error("Add meg a neved!");
      return true;
    }
    saveName(name.trim());
    return false;
  };

  const onCreate = async () => {
    if (needName()) return;
    setBusy("create");
    const r = await createRoom({ data: { name: name.trim(), size, maxPenalty } }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return void toast.error(r?.error ?? "Nem sikerült a kapcsolat.");
    setSession(r.data.code, { token: r.data.token, seat: r.data.seat });
    navigate({ to: "/szoba/$code", params: { code: r.data.code } });
  };

  const onJoin = async () => {
    if (needName()) return;
    const c = code.trim().toUpperCase();
    if (c.length !== 5) return void toast.error("A szobakód 5 karakter.");
    setBusy("join");
    const r = await joinRoom({ data: { code: c, name: name.trim() } }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return void toast.error(r?.error ?? "Nem sikerült a kapcsolat.");
    setSession(c, { token: r.data.token, seat: r.data.seat });
    navigate({ to: "/szoba/$code", params: { code: c } });
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="text-center">
        <div className="mb-6 flex justify-center">
          <PlayingCard card={{ id: "a", suit: "H", rank: 1 }} className="-rotate-12 translate-x-3" />
          <PlayingCard card={{ id: "b", suit: "X", rank: 0 }} className="z-10 -translate-y-2" />
          <PlayingCard card={{ id: "c", suit: "S", rank: 13 }} className="rotate-12 -translate-x-3" />
        </div>
        <h1 className="text-gold text-4xl font-bold leading-tight">Römi Online</h1>
        <p className="mt-2 text-muted-foreground">2–4 játékos, egy asztal. Valós idejű römi.</p>
      </header>

      <section className="felt-panel space-y-5 p-5">
        <label className="block space-y-2">
          <span className="text-sm font-semibold">A neved</span>
          <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="pl. Kata" className="h-12 text-base" />
        </label>
        <div className="space-y-2">
          <span className="text-sm font-semibold">Játékosok száma</span>
          <div className="grid grid-cols-3 gap-2">
            {[2, 3, 4].map((n) => (
              <Button key={n} variant={size === n ? "gold" : "felt"} onClick={() => setSize(n)} aria-pressed={size === n}>
                {n} fő
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-sm font-semibold">Játék vége ennyi büntetőpontnál</span>
          <div className="grid grid-cols-4 gap-2">
            {PENALTY_LIMITS.map((n) => (
              <Button key={n} variant={maxPenalty === n ? "gold" : "felt"} onClick={() => setMaxPenalty(n)} aria-pressed={maxPenalty === n}>
                {n}
              </Button>
            ))}
          </div>
        </div>
        <Button variant="gold" size="xl" className="w-full" onClick={onCreate} disabled={!!busy}>
          {busy === "create" ? "Szoba létrehozása…" : "Új szoba létrehozása"}
        </Button>
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" />vagy<span className="h-px flex-1 bg-border" />
        </div>
        <div className="flex gap-2">
          <Input
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="KÓD"
            className="h-12 flex-1 text-center font-mono text-lg tracking-[0.4em] uppercase"
          />
          <Button variant="outline" size="xl" onClick={onJoin} disabled={!!busy}>
            {busy === "join" ? "…" : "Csatlakozás"}
          </Button>
        </div>
      </section>

      <details className="felt-panel p-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Szabályok röviden</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>2–4 játékos, 2 pakli francia kártya + 4 joker. A kezdő 15, a többiek 14 lapot kapnak; a kezdő első lépése a dobás.</li>
          <li>A körödben húzz egyet a pakliból vagy vedd fel a legfelső dobott lapot.</li>
          <li>A saját első körödben a dobott lapot szabadon felveheted. Később, amíg nem pakoltál le, csak akkor, ha vele együtt azonnal legalább 51 ponttal lepakolsz.</li>
          <li>Sor: 3–4 azonos értékű, különböző színű lap. Sorozat: legalább 3 egymást követő, azonos színű lap. Egy kombinációban legfeljebb egy joker lehet.</li>
          <li>Az első lepakolás legalább 51 pont legyen (ász 10, de A-2-3-ban 1; figurák 10; joker a helyettesített lap értéke).</li>
          <li>Lepakolás után új kombinációt rakhatsz, vagy bármelyik asztali kombinációhoz hozzárakhatsz.</li>
          <li>A kör végén dobj el egy lapot. Aki elsőként kifogy a lapokból, nyer.</li>
          <li>Aki kimegy, nem kap pontot; a többiek a kezükben maradt lapok értékét kapják büntetőpontként (dupla, ha nem pakoltak le; ha a nyertes kézből ment ki, mindenkinek dupla). A kevesebb pont a jobb.</li>
          <li>Ha valaki eléri a szobában beállított maximális büntetőpontot, a játék véget ér; a legkevesebb ponttal rendelkező játékos nyer.</li>
        </ul>
      </details>
    </main>
  );
}
