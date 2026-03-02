/**
 * ParallelizablePanel — Check whether the currently accepted non-branching
 * path is "parallelizable" (boundary-crossing solid edges form a non-crossing
 * chord diagram) and, if so, display the resulting region partition of the
 * fundamental domain.
 *
 * Each solid edge seeds one coloured region via a Voronoi BFS over the node
 * adjacency graph.  The coloured SVG gives an intuitive view of how the path
 * "stripes" the rhombus.
 */

import { useMemo } from "react";
import type { OrbifoldGrid, NodePolygon } from "../orbifoldbasics";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";
import {
  isPathParallelizable,
  generateParallelizableRegions,
} from "../parallelizable";

// ---------------------------------------------------------------------------
// Constants — match the scale used by OrbifoldGridTools / PathResultRenderer
// ---------------------------------------------------------------------------
const CELL_SIZE = 40;
const GRID_PADDING = 20;

/** Perceptually distinct hue sequence via the golden angle (~137.5°). */
function regionColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 65%, 62%)`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ParallelizablePanelProps {
  grid: OrbifoldGrid<ColorData, EdgeStyleData>;
  wallpaperGroup?: string;
}

export function ParallelizablePanel({
  grid,
  wallpaperGroup,
}: ParallelizablePanelProps) {
  // Groups that use doubled coordinate systems need a halved visual scale
  const isDoubled =
    wallpaperGroup === "P3" ||
    wallpaperGroup === "P4" ||
    wallpaperGroup === "P4g" ||
    wallpaperGroup === "P6" ||
    wallpaperGroup === "cmm" ||
    wallpaperGroup === "P2hex";

  const parallelizable = useMemo(
    () => isPathParallelizable(grid),
    [grid],
  );

  const regionsResult = useMemo(
    () => (parallelizable ? generateParallelizableRegions(grid) : null),
    [grid, parallelizable],
  );

  // Compute SVG layout (bounding-box → screen coordinates)
  const layout = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of grid.nodes.values()) {
      for (const [x, y] of node.polygon) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    const scale = isDoubled ? CELL_SIZE / 4 : CELL_SIZE / 2;
    const svgW = (maxX - minX) * scale + 2 * GRID_PADDING;
    const svgH = (maxY - minY) * scale + 2 * GRID_PADDING;
    const toSvgX = (x: number) => (x - minX) * scale + GRID_PADDING;
    const toSvgY = (y: number) => (y - minY) * scale + GRID_PADDING;
    const polyPoints = (polygon: NodePolygon) =>
      polygon.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ");
    return { svgW, svgH, polyPoints };
  }, [grid, isDoubled]);

  const solidCount = regionsResult?.solidEdgeIds.length ?? 0;
  const regionCount = regionsResult?.numRegions ?? 0;

  const pluralize = (n: number, word: string) =>
    `${n} ${word}${n !== 1 ? "s" : ""}`;

  const summaryText =
    solidCount > 0
      ? `${pluralize(solidCount, "solid edge")} → ${pluralize(regionCount, "region")}.`
      : "No solid edges (trivially parallelizable).";

  return (
    <div
      style={{
        marginBottom: "10px",
        padding: "10px",
        backgroundColor: parallelizable ? "#eafaf1" : "#fdedec",
        borderRadius: "8px",
        border: `1px solid ${parallelizable ? "#27ae60" : "#e74c3c"}`,
      }}
    >
      <div
        style={{ fontWeight: "bold", marginBottom: "6px", fontSize: "13px" }}
      >
        🔲 Parallelizability
      </div>

      {parallelizable ? (
        <>
          <p
            style={{
              fontSize: "12px",
              color: "#1e8449",
              marginBottom: "8px",
            }}
          >
            ✅ Parallelizable! {summaryText}
          </p>

          {regionsResult && solidCount > 0 && (
            <svg
              width={layout.svgW}
              height={layout.svgH}
              style={{
                border: "1px solid #abebc6",
                borderRadius: "4px",
                display: "block",
              }}
            >
              {Array.from(grid.nodes.values()).map((node) => {
                const regionIdx =
                  regionsResult.regionMap.get(node.id) ?? 0;
                return (
                  <polygon
                    key={node.id}
                    points={layout.polyPoints(node.polygon)}
                    fill={regionColor(regionIdx)}
                    stroke="rgba(0,0,0,0.25)"
                    strokeWidth={0.5}
                  />
                );
              })}
            </svg>
          )}
        </>
      ) : (
        <p style={{ fontSize: "12px", color: "#922b21" }}>
          ❌ Not parallelizable: the boundary-crossing solid edges create
          crossing chords when the domain boundary is mapped to a circle.
        </p>
      )}
    </div>
  );
}
