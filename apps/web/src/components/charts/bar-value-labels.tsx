"use client";

import { motion } from "motion/react";
import { intFmt } from "./chart-formatters";
import { useChartStable, useYScale } from "./chart-context";

export interface BarValueLabelsProps {
  /** Data key whose values are printed above the bars. Defaults to the first series. */
  valueKey?: string;
  /** Gap in px between the bar top and its label. Default: 7 */
  offset?: number;
  /** Group gap used by `Bar` (px). Default: 4 */
  groupGap?: number;
  /** Value formatter. Default: integer with thousands separators. */
  formatValue?: (value: number) => string;
}

/**
 * Value labels above vertical bars. Uses `valueKey` rather than `dataKey` so
 * `BarChart` does not mistake this child for another bar series.
 */
export function BarValueLabels({
  valueKey,
  offset = 7,
  groupGap = 4,
  formatValue = (value) => intFmt(Math.round(value)),
}: BarValueLabelsProps) {
  const { data, lines, barScale, bandWidth, barXAccessor, orientation, isLoaded } =
    useChartStable();

  const key = valueKey ?? lines[0]?.dataKey;
  const seriesIndex = Math.max(
    0,
    lines.findIndex((line) => line.dataKey === key)
  );
  const seriesCount = Math.max(1, lines.length);
  const scale = useYScale(lines[seriesIndex]?.yAxisId);

  if (
    orientation === "horizontal" ||
    !key ||
    !barScale ||
    !bandWidth ||
    !barXAccessor
  ) {
    return null;
  }

  const effectiveGroupGap = seriesCount > 1 ? groupGap : 0;
  const barWidth = (bandWidth - effectiveGroupGap * (seriesCount - 1)) / seriesCount;

  return (
    <g aria-hidden="true">
      {data.map((datum, index) => {
        const value = datum[key];
        if (typeof value !== "number" || value <= 0) {
          return null;
        }

        const category = barXAccessor(datum);
        const bandX = barScale(category) ?? 0;
        const x =
          bandX +
          seriesIndex * (barWidth + effectiveGroupGap) +
          barWidth / 2;
        const y = scale(value) - offset;

        return (
          <motion.text
            animate={{ opacity: isLoaded ? 1 : 0 }}
            className="fill-slate-700 text-[11px] font-semibold tabular-nums"
            initial={{ opacity: 0 }}
            key={`value-${category}`}
            textAnchor="middle"
            transition={{ duration: 0.3, delay: isLoaded ? index * 0.02 : 0 }}
            x={x}
            y={y}
          >
            {formatValue(value)}
          </motion.text>
        );
      })}
    </g>
  );
}

BarValueLabels.displayName = "BarValueLabels";

export default BarValueLabels;
