"use client";

type SegmentedItem<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  items: Array<SegmentedItem<T>>;
  onChange: (next: T) => void;
  className?: string;
};

export function SegmentedControl<T extends string>({
  label,
  value,
  items,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={`balloon-group segmented-control ${className ?? ""}`.trim()} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`balloon-button ${value === item.value ? "active" : ""}`}
          onClick={() => onChange(item.value)}
          aria-pressed={value === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
