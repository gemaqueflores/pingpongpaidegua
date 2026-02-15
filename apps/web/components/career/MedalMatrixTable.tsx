import React from "react";

type MedalRow = {
  estadual: number;
  copa: number;
  brasileirao: number;
  open: number;
  total: number;
};

export type MedalMatrix = {
  ouro: MedalRow;
  prata: MedalRow;
  bronze: MedalRow;
};

type MedalMatrixTableProps = {
  matrix: MedalMatrix;
};

function formatCount(value: number): string {
  return String(Math.max(0, value)).padStart(2, "0");
}

export function MedalMatrixTable({ matrix }: MedalMatrixTableProps) {
  const rows: Array<{ medal: "ouro" | "prata" | "bronze"; label: string; emoji: string; values: MedalRow }> = [
    { medal: "ouro", label: "Ouro", emoji: "🥇", values: matrix.ouro },
    { medal: "prata", label: "Prata", emoji: "🥈", values: matrix.prata },
    { medal: "bronze", label: "Bronze", emoji: "🥉", values: matrix.bronze },
  ];

  return (
    <section className="career-medal-matrix" aria-label="Medalhas por tipo de competição">
      <h3>Medalhas</h3>
      <div className="career-medal-matrix-scroll">
        <table className="career-medal-table">
          <thead>
            <tr>
              <th>Medalha</th>
              <th>Estadual</th>
              <th>Copa</th>
              <th>Brasileirão</th>
              <th>Open</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.medal} className={`career-medal-row-${row.medal}`}>
                <td>
                  {row.emoji} {row.label}
                </td>
                <td>{formatCount(row.values.estadual)}</td>
                <td>{formatCount(row.values.copa)}</td>
                <td>{formatCount(row.values.brasileirao)}</td>
                <td>{formatCount(row.values.open)}</td>
                <td><strong>{formatCount(row.values.total)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
