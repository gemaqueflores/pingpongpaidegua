import { siteContent } from "../../lib/siteContent";

export function PublicFooter() {
  return (
    <footer className="arena-footer public-site-footer">
      <div className="public-site-footer-links">
        <a href="/sobre">Sobre</a>
        <a href="/contato">Contato</a>
        <a href="/privacidade">Privacidade</a>
        <a href={siteContent.socialLinks.github} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href={siteContent.socialLinks.instagram} target="_blank" rel="noreferrer">
          Instagram
        </a>
      </div>
      <p>
        {siteContent.projectName} {"\u00a9"} {new Date().getFullYear()} {"\u00b7"}{" "}
        {siteContent.shortDescription}
      </p>
      <p>{siteContent.amazonAffiliateDisclosure}</p>
      <p>
        Contato: <a href={`mailto:${siteContent.contactEmail}`}>{siteContent.contactEmail}</a>
      </p>
    </footer>
  );
}
