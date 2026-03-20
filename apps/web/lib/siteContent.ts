export const siteContent = {
  projectName: "PingPong Paid'egua",
  contactEmail: "gemaqueflores@gmail.com",
  responsibleName: "Leonardo Flores",
  cityState: "Belém/PA",
  shortDescription:
    "Plataforma independente de acompanhamento, análise e consulta de eventos de tênis de mesa no Brasil.",
  heroStatement:
    "Acompanhamento de eventos, atletas, clubes e resultados de tênis de mesa com foco em integridade e análise esportiva.",
  amazonAffiliateDisclosure:
    "Este site pode conter links de afiliado. Se você realizar uma compra por esses links, o projeto pode receber comissão sem custo adicional para você.",
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
    "Olá,",
    "",
    "Quero receber novidades do PingPong Paid'egua.",
    email ? `Meu e-mail: ${email}` : "",
    "",
    "Obrigado.",
  ].filter(Boolean);

  return `mailto:${siteContent.contactEmail}?subject=${subject}&body=${encodeURIComponent(lines.join("\n"))}`;
}
