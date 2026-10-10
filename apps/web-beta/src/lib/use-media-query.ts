import { useEffect, useState } from "react";

/** Tailwind breakpoints the Mesajlar page switches layouts on. */
export const breakpoints = { lg: "(min-width: 1024px)", xl: "(min-width: 1280px)" } as const;

/** `matchMedia` as state; true/false follows resizes and rotations. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
