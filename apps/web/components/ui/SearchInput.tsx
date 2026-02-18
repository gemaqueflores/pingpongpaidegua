"use client";

import { useEffect, useState } from "react";

type SearchInputProps = {
  value?: string;
  onChange?: (value: string) => void;
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  stickyClassName?: string;
};

export function SearchInput({
  value,
  onChange,
  onDebouncedChange,
  debounceMs = 250,
  placeholder,
  ariaLabel,
  className,
  stickyClassName,
}: SearchInputProps) {
  const [internal, setInternal] = useState(value ?? "");

  useEffect(() => {
    if (typeof value === "string") {
      setInternal(value);
    }
  }, [value]);

  useEffect(() => {
    if (!onDebouncedChange) return;
    const timeout = setTimeout(() => onDebouncedChange(internal), debounceMs);
    return () => clearTimeout(timeout);
  }, [debounceMs, internal, onDebouncedChange]);

  return (
    <div className={`search-input-wrap ${stickyClassName ?? ""}`.trim()}>
      <span className="search-input-icon" aria-hidden="true">🔎</span>
      <input
        className={`home-athletes-search search-input-with-icon ${className ?? ""}`.trim()}
        value={internal}
        onChange={(event) => {
          const next = event.target.value;
          setInternal(next);
          onChange?.(next);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoCapitalize="none"
        autoCorrect="off"
      />
    </div>
  );
}
