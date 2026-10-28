/**
 * One placement for every floating editor panel over the Zone Map (instructor
 * "Editing service area", the Service-area editor, "Measure distance"), so they
 * never drift apart.
 *
 * Top-right keeps the middle of the map clear. `max-h` leaves ~8rem at the
 * bottom for Google's zoom control and attribution; a taller panel scrolls
 * inside itself. The panel only covers its own box, so the rest of the map
 * keeps panning, zooming and drawing.
 */
export const MAP_PANEL_CLASS =
  "absolute right-3 top-3 z-20 max-h-[calc(100%-8rem)] w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto rounded-md border bg-background p-3 shadow-md";
