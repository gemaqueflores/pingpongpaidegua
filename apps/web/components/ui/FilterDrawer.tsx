"use client";

import type { ReactNode } from "react";

type FilterDrawerProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
};

export function FilterDrawer({ title, open, onToggle, children, className }: FilterDrawerProps) {
  return (
    <section className={`filter-drawer ${className ?? ""}`.trim()}>
      <button
        type="button"
        className="events-filter-trigger"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="filter-drawer-panel"
      >
        {open ? `Ocultar ${title}` : `Filtrar ${title}`}
      </button>
      <div id="filter-drawer-panel" className={`home-event-filters-panel ${open ? "open" : ""}`}>
        {children}
      </div>
    </section>
  );
}
