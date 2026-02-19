import type { ReactNode } from "react";
import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Veja nossos atletas de Tênis de Mesa",
  description: "Veja nossos atletas de Tênis de Mesa",
  path: "/atletas",
});

export default function AtletasLayout({ children }: { children: ReactNode }) {
  return children;
}
