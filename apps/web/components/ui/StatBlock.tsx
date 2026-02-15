import React from "react";
import { designTokens } from "../../lib/designTokens";

type StatBlockTone = "neutral" | "win" | "loss";

type StatBlockProps = {
  label: string;
  value: string;
  tone?: StatBlockTone;
  hint?: string;
};

export function StatBlock({ label, value, tone = "neutral", hint }: StatBlockProps) {
  return (
    <div
      className={`stat-block stat-block-${tone}`}
      style={{
        borderRadius: designTokens.radius.component,
        padding: designTokens.spacing.sm,
      }}
    >
      <span className="stat-block-value">{value}</span>
      <span className="stat-block-label">{label}</span>
      {hint ? <span className="stat-block-hint">{hint}</span> : null}
    </div>
  );
}


