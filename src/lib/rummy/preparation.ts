/** Private UI arrangement only; no game rules live here. */
export function retainPreparation(groups: string[][], available: string[]) {
  const ids = new Set(available);
  return groups.map((g) => g.filter((id) => ids.has(id))).filter((g) => g.length > 0);
}