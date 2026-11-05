/**
 * The cumulative profit chart. Inline SVG, rendered on the server.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO CHART LIBRARY
 *
 * A charting library for one line is 40–100kB of JavaScript on the heaviest
 * page of the site, to draw something that is a `<polyline>`. It would also
 * make the chart client-rendered, which means it is absent in the HTML, absent
 * for a crawler, and a layout shift when it arrives. This is a server
 * component that emits an SVG; the page needs no JavaScript at all to show
 * its most important evidence.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE THREE HONESTY RULES, AND WHERE EACH ONE LIVES
 *
 *   NO SMOOTHING   — a `<polyline>` through every settled tip. A curve
 *                    through fewer points, or a moving average, would turn
 *                    the drawdowns into gentle slopes. That is the detail a
 *                    reader is looking for, so it stays sharp.
 *
 *   NO CROPPING    — the y axis comes from `seriesBounds`, which always
 *                    includes zero. An axis fitted to the data would put the
 *                    series minimum on the floor and make a record that spent
 *                    a month under water look like one that rose from it.
 *
 *   THE DRAWDOWN IS DRAWN — not left for the reader to spot. The deepest
 *                    peak-to-trough fall is marked, labelled and stated in
 *                    words, because a cumulative line is exactly the chart
 *                    whose bad news is easiest to not notice.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ACCESSIBILITY
 *
 * `role="img"` with a label that states the figures a sighted reader takes
 * from the shape: where it ended and how far it fell. The full data is
 * immediately below in a real table, which is a better screen-reader
 * experience than any sonification of a line — so the chart does not try to
 * duplicate it.
 */
import {
  type CumulativePoint,
  maxDrawdown,
  seriesBounds,
} from '@/lib/tips/series'
import { formatProfitUnits } from '@/lib/format/czech'

/** A fixed viewBox, scaled by CSS. No measurement, so no client JavaScript. */
const WIDTH = 960
const HEIGHT = 320
const PADDING = { top: 12, right: 12, bottom: 28, left: 56 } as const

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

export type CumulativeChartProps = {
  points: readonly CumulativePoint[]
  /** Labels, from the message catalogue. */
  labels: {
    drawdown: string
    axisProfit: string
    axisTip: string
    empty: string
  }
}

export const CumulativeChart = ({ points, labels }: CumulativeChartProps) => {
  if (points.length === 0) {
    return <p className="text-body text-ink-muted">{labels.empty}</p>
  }

  const bounds = seriesBounds(points)
  const drawdown = maxDrawdown(points)

  const span = bounds.maxHundredths - bounds.minHundredths
  const lastIndex = points[points.length - 1]?.index ?? 1

  const x = (index: number): number =>
    PADDING.left + (lastIndex === 0 ? 0 : (index / lastIndex) * PLOT_WIDTH)

  const y = (hundredths: number): number =>
    PADDING.top +
    PLOT_HEIGHT -
    ((hundredths - bounds.minHundredths) / span) * PLOT_HEIGHT

  /**
   * The line starts at (0, 0).
   *
   * Before the first tip the running total is zero, and starting the line at
   * the first tip's RESULT hides that first move — which for a record that
   * opened with a loss is the most informative segment it has.
   */
  const path = [
    `${x(0)},${y(0)}`,
    ...points.map(
      (point) => `${x(point.index)},${y(point.cumulativeHundredths)}`,
    ),
  ].join(' ')

  const finalValue = points[points.length - 1]?.cumulativeHundredths ?? 0
  const zeroY = y(0)

  const description = [
    `${labels.axisProfit}: ${formatProfitUnits(finalValue)}`,
    `${labels.axisTip} ${lastIndex}`,
    drawdown
      ? `${labels.drawdown}: ${formatProfitUnits(-drawdown.depthHundredths)}`
      : null,
  ]
    .filter(Boolean)
    .join('. ')

  /*
   * The viewBox gives the element its aspect ratio, so `w-full h-auto` sizes
   * it correctly before anything loads and the chart cannot shift the page.
   *
   * `preserveAspectRatio` is left at its default: stretching the drawing to
   * fill an arbitrary box would stretch the axis labels with it, and a chart
   * with distorted type looks broken.
   */
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={description}
        className="h-auto w-full"
      >
        {/* --- The zero line, which is the one gridline that means something */}
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-border-strong)"
          strokeWidth={1.5}
        />
        <text
          x={PADDING.left - 8}
          y={zeroY + 4}
          textAnchor="end"
          fontSize={12}
          fill="var(--color-ink-muted)"
        >
          0
        </text>

        {/* --- Axis extremes, labelled. Two numbers, not a grid: the table
                below holds the detail, and a chart covered in gridlines
                invites reading values off it that it cannot support. */}
        <text
          x={PADDING.left - 8}
          y={PADDING.top + 10}
          textAnchor="end"
          fontSize={12}
          fill="var(--color-ink-muted)"
        >
          {formatProfitUnits(bounds.maxHundredths)}
        </text>
        <text
          x={PADDING.left - 8}
          y={PADDING.top + PLOT_HEIGHT}
          textAnchor="end"
          fontSize={12}
          fill="var(--color-ink-muted)"
        >
          {formatProfitUnits(bounds.minHundredths)}
        </text>

        {/* --- The drawdown, marked before the line so the line sits on top */}
        {drawdown && drawdown.depthHundredths > 0 ? (
          <g>
            <rect
              x={x(drawdown.peakIndex)}
              y={y(drawdown.peakHundredths)}
              width={Math.max(
                x(drawdown.troughIndex) - x(drawdown.peakIndex),
                2,
              )}
              height={Math.max(
                y(drawdown.troughHundredths) - y(drawdown.peakHundredths),
                2,
              )}
              fill="var(--color-result-loss)"
              // Low opacity so it reads as a region rather than as data. The
              // loss tone is deliberate: this is the bad news, shown in the
              // colour the rest of the site uses for bad news.
              opacity={0.12}
            />
            <line
              x1={x(drawdown.peakIndex)}
              x2={x(drawdown.troughIndex)}
              y1={y(drawdown.peakHundredths)}
              y2={y(drawdown.peakHundredths)}
              stroke="var(--color-result-loss)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          </g>
        ) : null}

        {/* --- The series itself */}
        <polyline
          points={path}
          fill="none"
          stroke="var(--color-brand-text)"
          strokeWidth={2}
          // `round` so a sharp reversal does not render as a spike artefact.
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* --- The final point, so the end of the record is unambiguous */}
        <circle
          cx={x(lastIndex)}
          cy={y(finalValue)}
          r={4}
          fill="var(--color-brand-text)"
        />

        {/* --- x axis label */}
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 8}
          textAnchor="end"
          fontSize={12}
          fill="var(--color-ink-muted)"
        >
          {labels.axisTip} {lastIndex}
        </text>
      </svg>

      {drawdown && drawdown.depthHundredths > 0 ? (
        <p className="text-body-sm text-ink-muted">
          <span className="font-semibold text-ink">{labels.drawdown}:</span>{' '}
          <span className="text-data-sm text-result-loss">
            {formatProfitUnits(-drawdown.depthHundredths)}
          </span>{' '}
          ({labels.axisTip} {drawdown.peakIndex} → {drawdown.troughIndex})
        </p>
      ) : null}
    </div>
  )
}
