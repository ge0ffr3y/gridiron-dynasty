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
    // A page being replaced can stay in the document, hidden, while the next one loads, and a page
    // draws its heading before its data arrives: so look only at visible headings, and keep
    // watching for a few seconds rather than stopping at the first one.
    const setTitle = () => {
      const heading = [...area.querySelectorAll("h1")]
        .find((h) => h.checkVisibility())
        ?.textContent?.trim();
      document.title = heading ? `${heading} - ${NAME}` : NAME;
    };
    setTitle();
    const watch = new MutationObserver(setTitle);
    watch.observe(area, { childList: true, subtree: true, characterData: true });
    const stop = setTimeout(() => watch.disconnect(), 3000);
    return () => {
      watch.disconnect();
      clearTimeout(stop);
    };
  }, [location, main]);
}
