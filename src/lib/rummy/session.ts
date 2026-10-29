export type Session = { token: string; seat: number };

export const getSession = (code: string): Session | null => {
  try {
    const raw = localStorage.getItem(`rummy:${code}`);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};
export const setSession = (code: string, s: Session) => localStorage.setItem(`rummy:${code}`, JSON.stringify(s));
export const clearSession = (code: string) => localStorage.removeItem(`rummy:${code}`);
export const getSavedName = () => (typeof localStorage === "undefined" ? "" : localStorage.getItem("rummy:name") ?? "");
export const saveName = (n: string) => localStorage.setItem("rummy:name", n);
