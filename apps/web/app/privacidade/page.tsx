import { UserShell } from "../../components/user/UserShell";
import { PublicFooter } from "../../components/user/PublicFooter";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { buildMetadata } from "../../lib/seo";
import { siteContent } from "../../lib/siteContent";

export const metadata = buildMetadata({
  title: `Privacidade | ${siteContent.projectName}`,
  description: `Pol\u00edtica de privacidade do ${siteContent.projectName}.`,
  path: "/privacidade",
});

export default function PrivacidadePage() {
  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader title="Privacidade" subtitle="Uso de dados e transpar\u00eancia" compact />

        <Card className="grid" variant="event">
          <h2>Dados p\u00fablicos de eventos</h2>
          <p className="arena-muted">
            O {siteContent.projectName} utiliza informa\u00e7\u00f5es p\u00fablicas de eventos
            esportivos para fins de consulta, organiza\u00e7\u00e3o e an\u00e1lise esportiva.
          </p>
        </Card>

        <Card className="grid" variant="event">
          <h2>Contato e solicita\u00e7\u00f5es</h2>
          <p className="arena-muted">
            Solicita\u00e7\u00f5es relacionadas ao site podem ser enviadas para{" "}
            <a href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>.
          </p>
        </Card>

        <Card className="grid" variant="event">
          <h2>Links e afiliados</h2>
          <p className="arena-muted">{siteContent.amazonAffiliateDisclosure}</p>
        </Card>

        <PublicFooter />
      </main>
    </UserShell>
  );
}
