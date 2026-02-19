import type { Metadata, ResolvingMetadata } from "next";
import type { ReactNode } from "react";
import { buildMetadata, fetchJson } from "../../../../../lib/seo";

type AthleteSummaryResponse = {
  event: {
    id: number;
    name: string;
  };
  athlete: {
    id: number;
    shortName: string;
    name: string;
  };
};

type AthleteEventLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string; athleteId: string }>;
};

export async function generateMetadata(
  { params }: AthleteEventLayoutProps,
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id, athleteId } = await params;
  const summary = await fetchJson<AthleteSummaryResponse>(
    `/events/${id}/athletes/${athleteId}/summary?orderBy=phase_hierarchy_datetime`,
  );

  const alias = summary?.athlete?.shortName || summary?.athlete?.name || `Atleta ${athleteId}`;
  const eventName = summary?.event?.name || `Evento ${id}`;

  return buildMetadata({
    title: `${alias} no evento ${eventName} de Tênis de Mesa`,
    description: `${alias} no evento ${eventName} de Tênis de Mesa`,
    path: `/events/${id}/athletes/${athleteId}`,
  });
}

export default function AthleteEventLayout({ children }: AthleteEventLayoutProps) {
  return children;
}
