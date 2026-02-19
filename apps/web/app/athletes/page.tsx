import AtletasPage from "../atletas/page";
import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Veja nossos atletas de Tênis de Mesa",
  description: "Veja nossos atletas de Tênis de Mesa",
  path: "/athletes",
});

export default function AthletesAliasPage() {
  return <AtletasPage />;
}
