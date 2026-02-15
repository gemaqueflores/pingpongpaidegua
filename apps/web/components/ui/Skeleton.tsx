import { designTokens } from "../../lib/designTokens";

type SkeletonProps = {
  width?: string;
  height?: string;
  className?: string;
};

export function Skeleton({ width = "100%", height = "14px", className = "" }: SkeletonProps) {
  return (
    <span
      className={`ui-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: designTokens.radius.component }}
      aria-hidden="true"
    />
  );
}
