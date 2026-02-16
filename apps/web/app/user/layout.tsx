"use client";

import type { ReactNode } from "react";
import { UserHeader } from "../../components/user/UserHeader";

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <div className="product-shell user-theme">
      <UserHeader />
      {children}
    </div>
  );
}

