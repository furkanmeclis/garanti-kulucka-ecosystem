import { useEffect, useRef } from "react";

/**
 * Realtime stand-in until the beta panel has a websocket client: runs `tick` every `intervalMs` while the tab is
 * visible, pauses while hidden and fires once when the tab becomes visible again. Swap the body for a WS
 * subscription later; callers only rely on "tick when something may have changed".
 */
export function usePolling(tick: () => void, intervalMs: number, enabled = true) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => tickRef.current(), intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
        timer = undefined;
      } else {
        tickRef.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
