import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/rummy/engine";

const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK_LABEL: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

export const rankLabel = (r: number) => RANK_LABEL[r] ?? String(r);

type Size = "xs" | "sm" | "md";
const SIZES: Record<Size, string> = {
  xs: "rounded-md",
  sm: "rounded-md",
  md: "rounded-lg",
};
/* Inline sizes so button height/font defaults can never squash the card's 1:1.43 shape. */
const sizeStyle = (w: string, font: number): CSSProperties => ({ width: w, height: `calc(${w} * 1.43)`, fontSize: `calc(${w} * ${font})` });
const SIZE_STYLE: Record<Size, CSSProperties> = {
  xs: sizeStyle("2rem", 0.31),
  sm: sizeStyle("var(--card-sm-w)", 0.3),
  md: sizeStyle("var(--card-md-w)", 0.27),
};

export function PlayingCard({
  card,
  size = "md",
  selected,
  dim,
  onClick,
  className,
}: {
  card: Card;
  size?: Size;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const joker = card.suit === "X";
  const red = card.suit === "H" || card.suit === "D";
  const content = joker ? (
    <span className="absolute inset-0 flex flex-col items-center justify-center font-display font-bold text-suit-red">
      <span className="text-[1.6em] leading-none">★</span>
      <span className="text-[0.55em] tracking-tight">JOKER</span>
    </span>
  ) : (
    <>
      <span className="absolute left-1 top-0.5 flex flex-col items-center font-bold leading-none"><span>{rankLabel(card.rank)}</span><span>{SUIT_SYMBOL[card.suit]}</span></span>
      <span className="absolute inset-0 flex items-center justify-center pt-2 text-[1.9em] leading-none">{SUIT_SYMBOL[card.suit]}</span>
    </>
  );
  const classes = cn("relative shrink-0 select-none border border-card-edge bg-card-face shadow-card transition-all duration-150 p-0 hover:bg-card-face", red ? "text-suit-red" : "text-suit-black", SIZES[size], selected && "-translate-y-3 shadow-lift", dim && "opacity-40", onClick && "active:scale-95", className);
  const label = joker ? "Joker" : `${rankLabel(card.rank)} ${SUIT_SYMBOL[card.suit]}`;
  if (onClick) return <Button variant="ghost" onClick={onClick} aria-label={label} aria-pressed={!!selected} className={classes} style={SIZE_STYLE[size]}>{content}</Button>;
  return (
    <div aria-label={label} className={classes} style={SIZE_STYLE[size]}>{content}</div>
  );
}

export function CardBack({ size = "md", className }: { size?: Size; className?: string }) {
  return <div className={cn("card-back shrink-0 shadow-card", SIZES[size], className)} style={SIZE_STYLE[size]} />;
}
