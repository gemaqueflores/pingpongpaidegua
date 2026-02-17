"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type NavItem = {
  id: "home" | "eventos" | "carreira" | "eficiencia" | "reporte" | "apoie";
  label: string;
  href: string;
  sectionId?: string;
  mode: "route" | "scroll";
  tone?: "primary" | "secondary";
};

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "home", href: "/", label: "Home", mode: "route", tone: "primary" },
  { id: "eventos", href: "/#eventos-em-destaque", label: "Eventos", sectionId: "eventos-em-destaque", mode: "scroll" },
  { id: "carreira", href: "/#atletas-da-base", label: "Carreira", sectionId: "atletas-da-base", mode: "scroll" },
  { id: "eficiencia", href: "/#clubes-eficiencia", label: "Eficiência", sectionId: "clubes-eficiencia", mode: "scroll" },
];

const SECONDARY_NAV_ITEMS: NavItem[] = [
  { id: "reporte", href: "/reportar-problema", label: "Reporte", mode: "route", tone: "secondary" },
  { id: "apoie", href: "/colabore", label: "Apoie", mode: "route", tone: "secondary" },
];

const PENDING_SCROLL_KEY = "pp_scroll_target";

export function UserHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeHomeSection, setActiveHomeSection] = useState<NavItem["id"]>("home");

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

  useEffect(() => {
    if (pathname !== "/") {
      return;
    }

    const pendingTarget = window.sessionStorage.getItem(PENDING_SCROLL_KEY);
    if (!pendingTarget) {
      return;
    }

    const element = document.getElementById(pendingTarget);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `/#${pendingTarget}`);
    }
    window.sessionStorage.removeItem(PENDING_SCROLL_KEY);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") {
      return;
    }

    const sections = PRIMARY_NAV_ITEMS.filter((item) => item.sectionId)
      .map((item) => ({ id: item.id, element: document.getElementById(item.sectionId as string) }))
      .filter((entry): entry is { id: NavItem["id"]; element: HTMLElement } => Boolean(entry.element));

    if (sections.length === 0) {
      return;
    }

    let currentSection: NavItem["id"] = "home";
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        if (visible.length === 0) {
          return;
        }

        const targetId = sections.find((section) => section.element === visible[0].target)?.id ?? "home";
        if (currentSection !== targetId) {
          currentSection = targetId;
          setActiveHomeSection((prev) => (prev === targetId ? prev : targetId));
        }
      },
      {
        root: null,
        threshold: [0.25, 0.5, 0.75],
        rootMargin: "-18% 0px -55% 0px",
      },
    );

    sections.forEach((section) => observer.observe(section.element));
    return () => observer.disconnect();
  }, [pathname]);

  const activeItemId = useMemo<NavItem["id"]>(() => {
    if (pathname === "/") {
      return activeHomeSection;
    }
    if (pathname.startsWith("/events")) return "eventos";
    if (pathname.startsWith("/career")) return "carreira";
    if (pathname.startsWith("/eficiencia")) return "eficiencia";
    if (pathname.startsWith("/reportar-problema")) return "reporte";
    if (pathname.startsWith("/colabore")) return "apoie";
    return "home";
  }, [pathname, activeHomeSection]);

  const handleNavClick = (item: NavItem) => {
    if (item.mode === "route") {
      if (pathname !== item.href) {
        router.push(item.href);
      }
      setMenuOpen(false);
      return;
    }

    if (!item.sectionId) {
      setMenuOpen(false);
      return;
    }

    if (pathname !== "/") {
      window.sessionStorage.setItem(PENDING_SCROLL_KEY, item.sectionId);
      router.push("/");
      setMenuOpen(false);
      return;
    }

    const target = document.getElementById(item.sectionId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `/#${item.sectionId}`);
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
          <div className="app-side-nav-group" data-group="primary">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-side-nav-link ${item.id === activeItemId ? "active" : ""} ${item.tone === "primary" ? "home-tone" : ""}`}
                onClick={() => handleNavClick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="app-side-nav-divider" role="presentation" />

          <div className="app-side-nav-group" data-group="secondary">
            {SECONDARY_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-side-nav-link ${item.id === activeItemId ? "active" : ""} secondary-tone`}
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
