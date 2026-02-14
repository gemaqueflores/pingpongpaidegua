"use client";

import type { ReactNode } from "react";

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <div className="product-shell user-theme">
      <header className="product-header user">
        <div className="container row" style={{ justifyContent: "space-between" }}>
          <strong>PingPong Paid'egua</strong>
          <nav className="row" aria-label="Navegação User">
            <a href="/">Home</a>
            <a href="/user/reportar-problema">Reportar problema</a>
            <a href="/user/colabore">Colabore com o projeto</a>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
