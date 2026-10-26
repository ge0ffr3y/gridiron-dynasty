/**
 * Route changes for assistive technology (Phase 18). A hash-routed page doesn't reload, so nothing
 * tells a screen reader that the page changed. On each navigation, focus moves to the main area and
 * the document title becomes the new page's heading (read once the page has drawn it).
 */
import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "wouter";

const NAME = "Gridiron Dynasty: GM Simulator";

export function useRouteAnnouncer(main: RefObject<HTMLElement | null>): void {
  const [location] = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const area = main.current;
    if (!area) return;
    if (!first.current) {
      area.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    first.current = false;
    const setTitle = () => {
      const heading = area.querySelector("h1")?.textContent?.trim();
      document.title = heading ? `${heading} - ${NAME}` : NAME;
      return Boolean(heading);
    };
    if (setTitle()) return;
    // Pages load on first visit: wait for the heading to appear.
    const watch = new MutationObserver(() => {
      if (setTitle()) watch.disconnect();
    });
    watch.observe(area, { childList: true, subtree: true });
    const stop = setTimeout(() => watch.disconnect(), 5000);
    return () => {
      watch.disconnect();
      clearTimeout(stop);
    };
  }, [location, main]);
}
