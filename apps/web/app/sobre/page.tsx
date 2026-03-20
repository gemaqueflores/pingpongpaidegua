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
            O projeto foi criado para oferecer leitura p\u00fablica, acompanhamento de eventos,
            consulta de atletas, efici\u00eancia de clubes e an\u00e1lise de resultados de
            t\u00eanis de mesa com foco em consist\u00eancia e transpar\u00eancia.
          </p>
        </Card>

        <Card className="grid" variant="event">
          <h2>Como usamos os dados</h2>
          <ul className="institutional-list">
            <li>Captura de informa\u00e7\u00f5es p\u00fablicas de eventos, categorias, atletas e resultados.</li>
            <li>Normaliza\u00e7\u00e3o e auditoria para leitura r\u00e1pida no site.</li>
            <li>Publica\u00e7\u00e3o de consultas para atletas, clubes e interessados no evento.</li>
          </ul>
        </Card>

        <Card className="grid" variant="event">
          <h2>Respons\u00e1vel</h2>
          <p className="arena-muted">
            {siteContent.responsibleName} {"\u00b7"} {siteContent.cityState}
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
