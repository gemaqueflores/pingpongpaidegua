"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getAuthToken, getUserRole } from "../../lib/auth";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = pathname === "/admin/login" || pathname === "/admin/reset-password";

  useEffect(() => {
    if (isPublicRoute) {
      return;
    }
    if (getUserRole() !== "ADMIN" || !getAuthToken()) {
      router.replace("/admin/login");
    }
  }, [isPublicRoute, router]);

  return (
    <div className="product-shell">
      <header className="product-header admin">
        <div className="container row" style={{ justifyContent: "space-between" }}>
          <strong>Produto Admin</strong>
          <nav className="row" aria-label="Navegação Admin">
            {!isPublicRoute ? (
              <>
                <a href="/admin">Eventos</a>
                <button
                  className="secondary"
                  onClick={() => {
                    clearAuth();
                    router.push("/admin/login");
                  }}
                >
                  Sair
                </button>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
