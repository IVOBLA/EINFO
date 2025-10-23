import React, { useRef } from "react";

export function PlacesAutocompleteInput({ value, onChange, inputRef, placeholder="Ort" }) {
  const ref = inputRef || useRef(null);
  return (
    <input
      ref={ref}
      className="rounded-md border px-2 py-1 text-sm w-full"
      placeholder={placeholder}
      autoComplete="off"
      value={value}
      onChange={(e)=>onChange(e.target.value)}
    />
  );
}
