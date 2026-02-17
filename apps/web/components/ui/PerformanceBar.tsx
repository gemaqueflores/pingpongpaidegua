"use client";
import React from "react";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function PerformanceBar({ percent }: { percent: number | null }) {
  const value = percent === null ? 0 : clamp(percent, 0, 100);
  const tone = value < 50 ? "low" : value <= 55 ? "mid" : "high";

  return (
    <div className="performance-bar-wrap" aria-label={`Aproveitamento ${value.toFixed(2)}%`}>
      <div className="performance-bar-track">
        <div className={`performance-bar-fill ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <strong className="performance-bar-value">{value.toFixed(2)}%</strong>
    </div>
  );
}
