import { UserShell } from "../../components/user/UserShell";
import { PublicFooter } from "../../components/user/PublicFooter";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { buildMetadata } from "../../lib/seo";
import { siteContent } from "../../lib/siteContent";

export const metadata = buildMetadata({
  title: `Contato | ${siteContent.projectName}`,
  description: `Contato e canais públicos do ${siteContent.projectName}.`,
  path: "/contato",
});

export default function ContatoPage() {
  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader title="Contato" subtitle="Canais públicos do projeto" compact />

        <Card className="grid" variant="event">
          <h2>Fale conosco</h2>
          <p className="arena-muted">
            E-mail: <a href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>
          </p>
          <p className="arena-muted">
            Responsável: {siteContent.responsibleName} · {siteContent.cityState}
          </p>
        </Card>

        <Card className="grid" variant="event">
          <h2>Links públicos</h2>
          <ul className="institutional-list">
            <li>
              <a href={siteContent.socialLinks.instagram} target="_blank" rel="noreferrer">
                Instagram
              </a>
            </li>
            <li>
              <a href={siteContent.socialLinks.youtube} target="_blank" rel="noreferrer">
                YouTube
              </a>
            </li>
            <li>
              <a href={siteContent.socialLinks.github} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </li>
          </ul>
        </Card>

        <Card className="grid" variant="event">
          <h2>Apoio</h2>
          <p className="arena-muted">PIX: {siteContent.pixKey}</p>
        </Card>

        <PublicFooter />
      </main>
    </UserShell>
  );
}
