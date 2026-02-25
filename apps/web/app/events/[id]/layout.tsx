import type { Metadata, ResolvingMetadata } from "next";
import type { ReactNode } from "react";
import { buildMetadata, fetchJson } from "../../../lib/seo";

type EventRow = {
  id: number;
  nome: string;
};

type EventLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

export async function generateMetadata(
  { params }: EventLayoutProps,
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id } = await params;
  const events = await fetchJson<EventRow[]>("/events");
  const eventName = events?.find((row) => String(row.id) === String(id))?.nome || "nome indisponível";

  return buildMetadata({
    title: `Confira o evento ${eventName} de Tênis de Mesa`,
    description: `Confira o evento ${eventName} de Tênis de Mesa`,
    path: `/events/${id}`,
  });
}

export default function EventLayout({ children }: EventLayoutProps) {
  return children;
}
