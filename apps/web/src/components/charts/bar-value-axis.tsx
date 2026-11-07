"use client";

import { motion } from "motion/react";
import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { intFmt } from "./chart-formatters";
import { useChartStable, useYScale } from "./chart-context";

export interface BarValueAxisProps {
  /** Series axis to mirror. Defaults to the chart's primary y-scale. */
  yAxisId?: string | number;
  /** Approximate number of ticks. Default: 4 */
  tickCount?: number;
  /** Tick label formatter. Default: integer with thousands separators. */
  formatTick?: (value: number) => string;
}

/**
 * Numeric value axis for vertical `BarChart`s. The categorical axis lives in
 * `BarXAxis`; this mirrors the y-scale so a bar length has a readable number
 * instead of only a tooltip.
 */
export function BarValueAxis(props: BarValueAxisProps) {
  const { containerRef, orientation } = useChartStable();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  if (orientation === "horizontal") {
    return null;
  }

  return <BarValueAxisInner {...props} container={container} />;
}

const BarValueAxisInner = memo(function BarValueAxisInner({
  yAxisId,
  tickCount = 4,
  formatTick = (value) => intFmt(Math.round(value)),
  container,
}: BarValueAxisProps & { container: HTMLDivElement }) {
  const { margin, isLoaded } = useChartStable();
  const scale = useYScale(yAxisId);
  // Counts are whole numbers — drop fractional ticks so labels never repeat.
  const ticks = scale.ticks(tickCount).filter((tick) => Number.isInteger(tick));

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{ width: margin.left }}
    >
      {ticks.map((tick) => {
        const y = margin.top + scale(tick);
        return (
          <motion.span
            animate={{ opacity: isLoaded ? 0.8 : 0 }}
            className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-right text-[11px] tabular-nums text-chart-label"
            initial={{ opacity: 0 }}
            key={tick}
            style={{ top: y }}
            transition={{ duration: 0.3 }}
          >
            {formatTick(tick)}
          </motion.span>
        );
      })}
    </div>,
    container
  );
});

BarValueAxis.displayName = "BarValueAxis";

export default BarValueAxis;
