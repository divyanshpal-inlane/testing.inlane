import { useEffect, useRef } from "react";

import type { ZoneCoordinate } from "./types";

/**
 * The Places dropdown is appended to `<body>`, so it needs an explicit z-index to
 * clear the header (`z-30`) and sidebar (`z-20`), plus pointer events restored
 * for its items.
 *
 * Reference-counted because two widgets can be live at once (the header search
 * and the sidebar location filter). A naive per-effect append/remove would let
 * whichever effect cleaned up first strip the override out from under the other,
 * leaving the open dropdown unclickable.
 */
let pacStyleEl: HTMLStyleElement | null = null;
let pacStyleUsers = 0;
const acquirePacStyles = (): (() => void) => {
  pacStyleUsers += 1;
  if (!pacStyleEl) {
    const el = document.createElement("style");
    el.dataset.mapPac = "1";
    el.textContent =
      ".pac-container{z-index:10000 !important;pointer-events:auto !important}" +
      ".pac-item{cursor:pointer !important}";
    document.head.appendChild(el);
    pacStyleEl = el;
  }
  return () => {
    pacStyleUsers -= 1;
    if (pacStyleUsers > 0 || !pacStyleEl) return;
    pacStyleEl.remove();
    pacStyleEl = null;
  };
};

/**
 * Attach a Google Places suggestion dropdown to one text input.
 *
 * Takes the input ELEMENT (null while it is not on screen), not a ref object.
 * A ref's `.current` is invisible to React, so an effect keyed on the ref never
 * re-ran when the element was replaced: the sidebar location filter renders a
 * brand-new `<input>` every time it is opened, and that fresh input silently got
 * no suggestions (and the header search was never wired at all). Keyed on the
 * element, the widget follows the input — attached when it mounts, released when
 * it unmounts, re-attached to the next one.
 *
 * `onPlace` fires only when the user picks a suggestion, which is the commit
 * point: half-typed text is not a location, so nothing happens on keystroke.
 * Free text is still handled separately by the Geocoder path.
 *
 * Country-restricted to IN: every service area is in India, and without this
 * "Koramangala" resolves to a same-named street on another continent.
 */
export function usePlacesAutocomplete(
  input: HTMLInputElement | null,
  /** True once the `places` library has been imported. */
  enabled: boolean,
  onPlace: (place: { at: ZoneCoordinate; label: string }) => void,
): void {
  // Held in a ref so re-rendering with a new callback does not tear the widget
  // down and re-attach it mid-typing, which drops the open dropdown.
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  useEffect(() => {
    if (!enabled || !input) return;
    if (!window.google?.maps?.places) return;

    const releaseStyles = acquirePacStyles();
    const ac = new window.google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: "IN" },
      fields: ["formatted_address", "geometry"],
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      onPlaceRef.current({
        at: { lat: loc.lat(), lng: loc.lng() },
        label: place?.formatted_address ?? "Pinned location",
      });
    });
    return () => {
      google.maps.event.clearInstanceListeners(ac);
      releaseStyles();
    };
  }, [enabled, input]);
}
