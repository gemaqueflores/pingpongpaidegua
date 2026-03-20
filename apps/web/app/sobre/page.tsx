import { UserShell } from "../../components/user/UserShell";
import { PublicFooter } from "../../components/user/PublicFooter";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { buildMetadata } from "../../lib/seo";
import { siteContent } from "../../lib/siteContent";

export const metadata = buildMetadata({
  title: `Sobre | ${siteContent.projectName}`,
  description: siteContent.shortDescription,
  path: "/sobre",
});

export default function SobrePage() {
  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader
          title={siteContent.projectName}
          subtitle={siteContent.heroStatement}
          compact
        />

        <Card className="grid" variant="event">
          <h2>Proposta</h2>
          <p className="arena-muted">{siteContent.shortDescription}</p>
          <p className="arena-muted">
            O projeto foi criado para oferecer leitura pública, acompanhamento de eventos, consulta de atletas,
            eficiência de clubes e análise de resultados de tênis de mesa com foco em consistência e transparência.
          </p>
        </Card>

        <Card className="grid" variant="event">
          <h2>Como usamos os dados</h2>
          <ul className="institutional-list">
            <li>Captura de informações públicas de eventos, categorias, atletas e resultados.</li>
            <li>Normalização e auditoria para leitura rápida no site.</li>
            <li>Publicação de consultas para atletas, clubes e interessados no evento.</li>
          </ul>
        </Card>

        <Card className="grid" variant="event">
          <h2>Responsável</h2>
          <p className="arena-muted">
            {siteContent.responsibleName} · {siteContent.cityState}
          </p>
          <p className="arena-muted">
            Contato principal: <a href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>
          </p>
        </Card>

        <PublicFooter />
      </main>
    </UserShell>
  );
}
