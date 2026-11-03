"use client";

export interface Metric {
  key: string;
  value: string;
  label: string;
}

interface MetricsStripProps {
  metrics: Metric[];
}

export function MetricsStrip({ metrics }: MetricsStripProps) {
  return (
    <div className="mt-7 grid grid-cols-2 items-stretch rounded-[18px] border border-tm-line bg-tm-surface shadow-[0_8px_28px_rgba(67,50,31,0.05)] sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((metric, index) => (
        <div
          key={metric.key}
          className={`min-w-0 px-3 py-[18px] text-center ${
            index === 0 ? "" : "border-l border-tm-line"
          }`}
        >
          <p className="font-serif text-[25px] font-medium leading-[1.1] tracking-[-0.03em] text-tm-ink tabular-nums">
            {metric.value}
          </p>
          <p className="mt-1.5 text-[11px] text-tm-faint">{metric.label}</p>
        </div>
      ))}
    </div>
  );
}
