import type { Metadata, ResolvingMetadata } from "next";
import type { ReactNode } from "react";
import { buildMetadata, fetchJson } from "../../../lib/seo";

type ClubCareerResponse = {
  club: {
    id: number;
    name: string;
  };
};

type ClubLayoutProps = {
  children: ReactNode;
  params: Promise<{ clubId: string }>;
};

export async function generateMetadata(
  { params }: ClubLayoutProps,
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { clubId } = await params;
  const club = await fetchJson<ClubCareerResponse>(`/clubs/${clubId}/efficiency-career`);
  const clubName = club?.club?.name ?? clubId;
  return buildMetadata({
    title: `Clube ${clubName}`,
    description: `Clube ${clubName}`,
    path: `/eficiencia/${clubId}`,
  });
}

export default function ClubLayout({ children }: ClubLayoutProps) {
  return children;
}
