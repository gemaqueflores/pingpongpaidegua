import React from "react";
import type { ReactNode } from "react";
import { designTokens } from "../../lib/designTokens";

type CardVariant = "event" | "athlete" | "group" | "match" | "stat" | "default";

type CardProps = {
  children?: ReactNode;
  header?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  className?: string;
  variant?: CardVariant;
};

export function Card({
  children,
  header,
  body,
  footer,
  className = "",
  variant = "default",
}: CardProps) {
  return (
    <section
      className={`card arena-card ui-card ui-card-${variant} ${className}`.trim()}
      style={{
        backgroundColor: designTokens.colors.cardBg,
        borderRadius: designTokens.radius.card,
        padding: designTokens.spacing.sm,
      }}
    >
      {header ? <header className="ui-card-header">{header}</header> : null}
      {body ? <div className="ui-card-body">{body}</div> : null}
      {children}
      {footer ? <footer className="ui-card-footer">{footer}</footer> : null}
    </section>
  );
}
