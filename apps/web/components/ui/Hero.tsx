import React from "react";
import type { ReactNode } from "react";
import { designTokens } from "../../lib/designTokens";

type HeroProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function Hero({ title, subtitle, actions }: HeroProps) {
  return (
    <section className="hero-header" style={{ padding: designTokens.spacing.sm }}>
      <h1 className="hero-title" style={{ fontFamily: designTokens.typography.titleFamily }}>{title}</h1>
      {subtitle ? <p className="hero-subtitle" style={{ color: designTokens.colors.accent }}>{subtitle}</p> : null}
      {actions ? <div className="row hero-actions-row">{actions}</div> : null}
    </section>
  );
}


