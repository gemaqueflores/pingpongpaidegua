"use client";

import type { ReactNode } from "react";
import { UserHeader } from "./UserHeader";

export function UserShell({ children }: { children: ReactNode }) {
  return (
    <div className="product-shell user-theme">
      <UserHeader />
      {children}
    </div>
  );
}

