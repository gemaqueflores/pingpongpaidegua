import { UserShell } from "../../components/user/UserShell";
import { PublicFooter } from "../../components/user/PublicFooter";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { buildMetadata } from "../../lib/seo";
import { siteContent } from "../../lib/siteContent";

export const metadata = buildMetadata({
  title: `Privacidade | ${siteContent.projectName}`,
  description: `Política de privacidade do ${siteContent.projectName}.`,
  path: "/privacidade",
});

export default function PrivacidadePage() {
  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader title="Privacidade" subtitle="Uso de dados e transparência" compact />

        <Card className="grid" variant="event">
          <h2>Dados públicos de eventos</h2>
          <p className="arena-muted">
            O {siteContent.projectName} utiliza informações públicas de eventos esportivos para
            fins de consulta, organização e análise esportiva.
          </p>
        </Card>

        <Card className="grid" variant="event">
          <h2>Contato e solicitações</h2>
          <p className="arena-muted">
            Solicitações relacionadas ao site podem ser enviadas para{" "}
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
