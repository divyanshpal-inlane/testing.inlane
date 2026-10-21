import { memo, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { googleMapsLoader } from "@/utils/googleMaps";

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string, lat: number | null, lng: number | null) => void;
  placeholder?: string;
  className?: string;
  /**
   * Forwarded to the underlying <input>. Required whenever the field sits
   * next to a <label htmlFor=...> -- this component is the label's `for`
   * target, so without it the label points at a non-existent id and clicking
   * it does not focus the input.
   */
  id?: string;
}

export const AddressAutocomplete = memo(
  ({
    value,
    onChange,
    placeholder = "Search address...",
    className = "",
    id,
  }: AddressAutocompleteProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(
      null,
    );
    const [internalValue, setInternalValue] = useState(value);
    // The parent usually passes a fresh `onChange` every render. Reading it
    // through a ref keeps the Autocomplete effect from re-running (and
    // stacking a new Google widget on the same <input>) on every keystroke.
    // Stacked widgets made the real selection land on an instance with no
    // listener, so the picked suggestion was dropped and React restored the
    // typed text.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // The Maps bootstrap no longer requests `places` (see LIBRARIES in
    // utils/googleMaps.ts), so `google.maps.places` is undefined until this
    // sub-library is imported. Constructing Autocomplete without it threw
    // "Cannot read properties of undefined (reading 'Autocomplete')" -- and
    // because that happened inside an effect with no try/catch, React tore
    // down the whole modal, which is why the booking form's fields
    // (including its <label for="customerAddress">) intermittently vanished.
    const [places, setPlaces] = useState<google.maps.PlacesLibrary | null>(
      null,
    );

    useEffect(() => {
      setInternalValue(value);
    }, [value]);

    useEffect(() => {
      let active = true;
      void googleMapsLoader
        .importLibrary<google.maps.PlacesLibrary>("places")
        .then((lib) => {
          if (active) setPlaces(lib);
        })
        .catch(() => {
          // No key / offline: degrade to a plain text input rather than
          // throwing inside the effect.
        });
      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      if (!inputRef.current || !places?.Autocomplete) return;

      let autocomplete: google.maps.places.Autocomplete;
      try {
        autocomplete = new places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "IN" },
          fields: ["formatted_address", "geometry"],
        });
      } catch (err) {
        console.error("Failed to initialize Google Maps Autocomplete:", err);
        return;
      }
      autocompleteRef.current = autocomplete;

      autocomplete.addListener("place_changed", () => {
        const place = autocompleteRef.current?.getPlace();
        // Google writes the suggestion the user clicked (name + full address,
        // exactly what the dropdown showed) into the input before this event.
        // Prefer that over formatted_address, which omits the place name.
        const shown = inputRef.current?.value.trim() ?? "";
        const addr =
          shown.includes(",") || !place?.formatted_address
            ? shown
            : place.formatted_address;
        if (!addr) return;

        const loc = place?.geometry?.location;
        setInternalValue(addr);
        onChangeRef.current(
          addr,
          loc ? loc.lat() : null,
          loc ? loc.lng() : null,
        );
      });

      return () => {
        google.maps.event.clearInstanceListeners(autocomplete);
        autocompleteRef.current = null;
      };
    }, [places]);

    const handleManualTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInternalValue(val);
      onChange(val, null, null);
    };

    return (
      <Input
        ref={inputRef}
        id={id}
        value={internalValue}
        onChange={handleManualTyping}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
    );
  },
);

AddressAutocomplete.displayName = "AddressAutocomplete";
