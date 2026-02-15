import React from "react";
import type { ReactNode } from "react";
import { designTokens } from "../../lib/designTokens";

type BadgeTone = "default" | "open" | "closed" | "done" | "win" | "lose";

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

export function Badge({ children, tone = "default" }: BadgeProps) {
  return (
    <span
      className={`ui-badge ui-badge-${tone}`}
      style={{
        borderRadius: designTokens.radius.component,
        letterSpacing: designTokens.typography.labelTracking,
      }}
    >
      {children}
    </span>
  );
}

