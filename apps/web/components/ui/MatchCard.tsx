import React from "react";
import { designTokens } from "../../lib/designTokens";

type MatchTone = "win" | "lose" | "neutral";

type MatchCardProps = {
  categoryName: string;
  phase: string;
  round: string;
  datetime: string;
  confrontation: string;
  setsLine: string;
  finalLine: string;
  tone: MatchTone;
};

function toneLabel(tone: MatchTone): string {
  if (tone === "win") return "Vitoria";
  if (tone === "lose") return "Derrota";
  return "Indefinido";
}

function toneIcon(tone: MatchTone): string {
  if (tone === "win") return "W";
  if (tone === "lose") return "L";
  return "-";
}

export function MatchCard({
  categoryName,
  phase,
  round,
  datetime,
  confrontation,
  setsLine,
  finalLine,
  tone,
}: MatchCardProps) {
  return (
    <article
      className={`match-card match-card-${tone}`}
      style={{ borderRadius: designTokens.radius.component, padding: designTokens.spacing.sm }}
    >
      <div className="match-card-head">
        <span className={`match-chip match-chip-${tone}`}>
          {toneIcon(tone)} {toneLabel(tone)}
        </span>
        <strong>{categoryName}</strong>
      </div>
      <p className="match-card-meta">{phase} | {round}</p>
      <p className="match-card-meta">{datetime}</p>
      <p className="match-card-vs">{confrontation}</p>
      <p className="match-card-sets">Sets: {setsLine}</p>
      <p className="match-card-final">Final: {finalLine}</p>
    </article>
  );
}



