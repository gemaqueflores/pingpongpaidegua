import React from "react";
import type { ReactNode } from "react";
import { designTokens } from "../../lib/designTokens";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function PageHeader({ title, subtitle, actions, compact = false, className }: PageHeaderProps) {
  const classes = ["hero-header", "page-header", compact ? "page-header-compact" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} style={{ padding: compact ? designTokens.spacing.xs : designTokens.spacing.sm }}>
      <h1 className="hero-title" style={{ fontFamily: designTokens.typography.titleFamily }}>
        {title}
      </h1>
      {subtitle ? (
        <p className="hero-subtitle" style={{ color: designTokens.colors.accent }}>
          {subtitle}
        </p>
      ) : null}
      {actions ? <div className="row hero-actions-row">{actions}</div> : null}
    </section>
  );
}

