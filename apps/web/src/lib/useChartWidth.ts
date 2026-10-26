/**
 * The width a chart has to draw in (Phase 18). The charts are SVG, drawn in their own units and
 * scaled to fit; on a phone a chart drawn 720 wide shrinks to about half size and its text with it.
 * Measuring the container instead lets each chart draw at the width it gets, so text stays readable.
 * Put the returned callback on the element the chart sits in.
 */
import { useEffect, useState } from "react";

export function useChartWidth(
  initial = 720,
  min = 300,
): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!el) return;
    const measure = (w: number) => setWidth(Math.max(min, Math.round(w)));
    measure(el.getBoundingClientRect().width || initial);
    const watch = new ResizeObserver(([entry]) => entry && measure(entry.contentRect.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, [el, initial, min]);
  return [setEl, width];
}
