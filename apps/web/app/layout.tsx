import "./globals.css";
import type { CSSProperties, ReactNode } from "react";
import type { Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import { designTokens } from "../lib/designTokens";
import { SITE_URL, buildMetadata } from "../lib/seo";
import { siteContent } from "../lib/siteContent";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], weight: ["700", "800"], display: "swap" });

// CSP nonces are request-specific; prerendered HTML cannot carry the current nonce.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  metadataBase: new URL(SITE_URL),
  ...buildMetadata({
    title: `${siteContent.projectName} | Tênis de Mesa`,
    description: siteContent.shortDescription,
    path: "/",
  }),
  authors: [{ name: `${siteContent.brand.name} / ${siteContent.responsibleName}` }],
  creator: siteContent.brand.name,
  applicationName: siteContent.projectName,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const tokenVars = {
    "--token-primary-bg": designTokens.colors.primaryBg,
    "--token-card-bg": designTokens.colors.cardBg,
    "--token-accent": designTokens.colors.accent,
    "--token-text-primary": designTokens.colors.textPrimary,
    "--token-text-secondary": designTokens.colors.textSecondary,
    "--token-win": designTokens.colors.win,
    "--token-loss": designTokens.colors.loss,
    "--token-space-xs": designTokens.spacing.xs,
    "--token-space-sm": designTokens.spacing.sm,
    "--token-space-md": designTokens.spacing.md,
    "--token-space-lg": designTokens.spacing.lg,
    "--token-space-xl": designTokens.spacing.xl,
    "--token-radius-card": designTokens.radius.card,
    "--token-radius-component": designTokens.radius.component,
    "--token-font-title": `${montserrat.style.fontFamily}, ${designTokens.typography.titleFamily}`,
    "--token-font-body": `${inter.style.fontFamily}, ${designTokens.typography.bodyFamily}`,
    "--token-label-tracking": designTokens.typography.labelTracking,
  } as CSSProperties;

  return (
    <html lang="pt-BR">
      <body style={tokenVars} className={inter.className}>{children}</body>
    </html>
  );
}
