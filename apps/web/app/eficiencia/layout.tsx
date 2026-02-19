import type { ReactNode } from "react";
import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Conheça nossos clubes",
  description: "Conheça nossos clubes",
  path: "/eficiencia",
});

export default function EficienciaLayout({ children }: { children: ReactNode }) {
  return children;
}
