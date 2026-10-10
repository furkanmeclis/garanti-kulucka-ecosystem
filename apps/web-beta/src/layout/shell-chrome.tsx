import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Lets a full-bleed page take the whole screen below lg (WhatsApp-style open chat): the shell then hides its
 * navbar and bottom bar on small screens. Desktop chrome never changes.
 */
const ShellChromeContext = createContext<{ immersive: boolean; setImmersive: (value: boolean) => void }>({ immersive: false, setImmersive: () => undefined });

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [immersive, setImmersive] = useState(false);
  return <ShellChromeContext.Provider value={{ immersive, setImmersive }}>{children}</ShellChromeContext.Provider>;
}

export function useShellChrome() {
  return useContext(ShellChromeContext);
}

/** Marks the page immersive while `active` (reset on unmount). */
export function useImmersive(active: boolean) {
  const { setImmersive } = useShellChrome();
  useEffect(() => {
    setImmersive(active);
    return () => setImmersive(false);
  }, [active, setImmersive]);
}

/**
 * Tracks the visual viewport height in `--app-vvh` so a full-height page shrinks with the on-screen keyboard
 * (iOS keeps 100dvh at the layout viewport) and the composer stays above it.
 */
export function useVisualViewportHeight(enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!enabled || !viewport) return;
    const update = () => {
      root.style.setProperty("--app-vvh", `${Math.round(viewport.height)}px`);
      // iOS scrolls the layout viewport when the keyboard opens; pin it so nothing slides under the notch.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--app-vvh");
    };
  }, [enabled]);
}
