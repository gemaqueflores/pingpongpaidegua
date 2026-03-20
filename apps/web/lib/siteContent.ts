export const siteContent = {
  projectName: "PingPong Paid'egua",
  contactEmail: "gemaqueflores@gmail.com",
  responsibleName: "Leonardo Flores",
  cityState: "Bel\u00e9m/PA",
  shortDescription:
    "Plataforma independente de acompanhamento, an\u00e1lise e consulta de eventos de t\u00eanis de mesa no Brasil.",
  heroStatement:
    "Acompanhamento de eventos, atletas, clubes e resultados de t\u00eanis de mesa com foco em integridade e an\u00e1lise esportiva.",
  amazonAffiliateDisclosure:
    "Este site pode conter links de afiliado. Se voc\u00ea realizar uma compra por esses links, o projeto pode receber comiss\u00e3o sem custo adicional para voc\u00ea.",
  socialLinks: {
    instagram: "https://www.instagram.com/gemaqueflores/",
    youtube: "https://www.youtube.com/@mushindosha",
    github: "https://github.com/gemaqueflores/",
  },
  pixKey: "227b600a-3d60-4229-90c8-3286d822b6ae",
};

export function buildWaitlistMailto(email?: string): string {
  const subject = encodeURIComponent("Lista de espera - PingPong Paid'egua");
  const lines = [
    "Ol\u00e1,",
    "",
    "Quero receber novidades do PingPong Paid'egua.",
    email ? `Meu e-mail: ${email}` : "",
    "",
    "Obrigado.",
  ].filter(Boolean);

  return `mailto:${siteContent.contactEmail}?subject=${subject}&body=${encodeURIComponent(lines.join("\n"))}`;
}
