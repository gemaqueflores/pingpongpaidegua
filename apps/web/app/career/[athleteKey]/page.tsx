import UserCareerPage from "../../user/career/[athleteKey]/page";
import { UserShell } from "../../../components/user/UserShell";
import type { Metadata, ResolvingMetadata } from "next";
import { buildMetadata, fetchJson } from "../../../lib/seo";

type CareerResponse = {
  athlete: {
    nameReduced: string;
    nameDisplay: string;
  };
};

type CareerPageProps = {
  params: Promise<{ athleteKey: string }>;
};

export async function generateMetadata(
  { params }: CareerPageProps,
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { athleteKey } = await params;
  const decodedKey = decodeURIComponent(athleteKey);
  const payload = await fetchJson<CareerResponse>(`/athletes/${encodeURIComponent(decodedKey)}/career`);
  const alias = payload?.athlete?.nameReduced || payload?.athlete?.nameDisplay || decodedKey;

  return buildMetadata({
    title: `${alias}: Carreira no Tênis de Mesa`,
    description: `${alias}: Carreira no Tênis de Mesa`,
    path: `/career/${encodeURIComponent(decodedKey)}`,
  });
}

export default function CareerCanonicalPage() {
  return (
    <UserShell>
      <UserCareerPage />
    </UserShell>
  );
}
