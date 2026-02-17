"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type NavItem = {
  id: "home" | "eventos" | "atletas" | "eficiencia" | "reporte" | "apoie";
  label: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "home", href: "/", label: "Home" },
  { id: "eventos", href: "/events", label: "Eventos" },
  { id: "atletas", href: "/atletas", label: "Atletas" },
  { id: "eficiencia", href: "/eficiencia", label: "Eficiência" },
  { id: "reporte", href: "/reporte", label: "Reporte" },
  { id: "apoie", href: "/apoie", label: "Apoie" },
];

export function UserHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const activeItemId = useMemo<NavItem["id"]>(() => {
    if (pathname === "/") return "home";
    if (pathname === "/events" || pathname.startsWith("/events/")) return "eventos";
    if (pathname === "/atletas" || pathname.startsWith("/atletas/")) return "atletas";
    if (pathname === "/eficiencia" || pathname.startsWith("/eficiencia/")) return "eficiencia";
    if (pathname === "/reporte" || pathname === "/reportar-problema") return "reporte";
    if (pathname === "/apoie" || pathname === "/colabore") return "apoie";
    return "home";
  }, [pathname]);

  const handleNavClick = (item: NavItem) => {
    if (pathname !== item.href) {
      router.push(item.href);
    }
    setMenuOpen(false);
  };

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
            <a className="app-cta-button" href="/reporte">
              Reportar
            </a>
            <a className="app-cta-button app-cta-button-secondary" href="/apoie">
              Apoie
            </a>
          </nav>
        </div>
      </header>

      <aside className={`app-side-menu ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <nav className="app-side-nav" aria-label="Menu lateral">
          <div className="app-side-nav-group" data-group="primary">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-side-nav-link ${item.id === activeItemId ? "active" : ""} ${item.id === "home" ? "home-tone" : ""} ${item.id === "reporte" || item.id === "apoie" ? "secondary-tone" : ""}`}
                onClick={() => handleNavClick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
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
