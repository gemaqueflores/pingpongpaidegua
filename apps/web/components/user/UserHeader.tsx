"use client";

import { useEffect, useState } from "react";

const MENU_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/#eventos-em-destaque", label: "Eventos" },
  { href: "/#atletas-da-base", label: "Carreira" },
  { href: "/eficiencia", label: "Eficiência" },
  { href: "/reportar-problema", label: "Reporte" },
  { href: "/colabore", label: "Apoie" },
];

export function UserHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [menuOpen]);

  return (
    <>
      <header className="product-header user app-user-header">
        <div className="container row app-user-header-row">
          <button
            type="button"
            className="app-menu-toggle"
            aria-label={menuOpen ? "Fechar menu lateral" : "Abrir menu lateral"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>

          <a className="app-brand-link" href="/">
            PingPong Paid&apos;egua
          </a>

          <nav className="row app-user-header-cta" aria-label="Ações rápidas">
            <a className="app-cta-button" href="/reportar-problema">
              Reportar
            </a>
            <a className="app-cta-button app-cta-button-secondary" href="/colabore">
              Apoie
            </a>
          </nav>
        </div>
      </header>

      <aside className={`app-side-menu ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <nav className="app-side-nav" aria-label="Menu lateral">
          {MENU_ITEMS.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          className="app-side-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  );
}
