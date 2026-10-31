<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Rummy rules live only in `src/lib/rummy/engine.ts` and run server-side via `rummy.functions.ts`; the browser only reads the public projection (`rummy_rooms`) and its own hand — never move rule decisions or hands to the client.
- Preparation is private per room/player/round browser storage; server functions validate combinations, and handi closures and grouped placements commit atomically to avoid partially applied moves.
- Completed natural four-suit sets are stored in secret retired cards, not recycled into stock, preserving deck conservation without displaying them on the table.
- Card sizes come from the `--card-md-w`/`--card-sm-w` CSS variables in `src/styles.css` (scaled by screen height and width) and the room screen is a fixed `h-dvh` column where only the table section scrolls, so hand, preparation and buttons always stay visible on any phone.
