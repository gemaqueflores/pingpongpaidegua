import React from "react";
import type { ReactNode } from "react";

type Column<T> = {
  key: string;
  header: string;
  render: (row: T, index: number) => ReactNode;
};

type DataTableResponsiveProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  mobileCard: (row: T, index: number) => ReactNode;
  empty: ReactNode;
  rowClassName?: (row: T, index: number) => string | undefined;
  className?: string;
};

export function DataTableResponsive<T>({
  columns,
  rows,
  mobileCard,
  empty,
  rowClassName,
  className,
}: DataTableResponsiveProps<T>) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <div className={`data-table-responsive ${className ?? ""}`.trim()}>
      <div className="data-table-responsive-desktop">
        <div className="global-mobile-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>{column.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className={rowClassName?.(row, index)}>
                  {columns.map((column) => (
                    <td key={column.key}>{column.render(row, index)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="data-table-responsive-mobile">
        {rows.map((row, index) => mobileCard(row, index))}
      </div>
    </div>
  );
}
