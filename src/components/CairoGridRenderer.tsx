import React, { useCallback, useMemo } from "react";
import type { ColorGrid, GridSolution, PathlengthConstraint, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  WALL_COLOR,
  getCairoTile,
  getCairoNeighborsWithDirection,
  findSharedEdge,
  createCairoTransformer,
  polyCentroid,
} from "./gridConstants";

interface CairoGridRendererProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  cellSize: number;
  totalWidth: number;
  totalHeight: number;
  wallThickness: number;
  viewMode: "sketchpad" | "solution";
  showDistanceLevels: boolean;
  selectedConstraintId: string | null;
  colorRoots: ColorRoots;
  distanceConstraint?: PathlengthConstraint;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  onMouseUp: () => void;
}

export const CairoGridRenderer: React.FC<CairoGridRendererProps> = ({
  grid,
  solution,
  cellSize,
  totalWidth,
  totalHeight,
  wallThickness,
  viewMode,
  showDistanceLevels,
  selectedConstraintId,
  colorRoots,
  distanceConstraint,
  onCellClick,
  onCellDrag,
  onMouseUp,
}) => {
  const svgWidth = totalWidth;
  const svgHeight = totalHeight;
  const padding = wallThickness;
  const showSolutionColors = viewMode === "solution" && solution !== null;

  // Create coordinate transformer
  const availableWidth = svgWidth - 2 * padding;
  const availableHeight = svgHeight - 2 * padding;
  const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);

  // Create a set of kept edge keys for quick lookup
  const keptEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (solution) {
      for (const edge of solution.keptEdges) {
        set.add(`${edge.u.row},${edge.u.col}-${edge.v.row},${edge.v.col}`);
        set.add(`${edge.v.row},${edge.v.col}-${edge.u.row},${edge.u.col}`);
      }
    }
    return set;
  }, [solution]);

  // Check if there should be a wall between two adjacent cells
  const hasWall = useCallback(
    (r1: number, c1: number, r2: number, c2: number): boolean => {
      if (!solution) {
        return !(r2 >= 0 && r2 < grid.height && c2 >= 0 && c2 < grid.width);
      }
      const key = `${r1},${c1}-${r2},${c2}`;
      return !keptEdgeSet.has(key);
    },
    [solution, keptEdgeSet, grid]
  );

  // Helper to check if a cell is a root for its color
  const isRootCell = useCallback(
    (row: number, col: number): boolean => {
      const cellColor = grid.colors[row][col];
      if (cellColor === null || cellColor === HATCH_COLOR || cellColor < 0) {
        return false;
      }
      const root = colorRoots[String(cellColor)];
      return root !== undefined && root.row === row && root.col === col;
    },
    [grid.colors, colorRoots]
  );

  // Helper to get distance level for a cell
  const getDistanceLevel = useCallback(
    (row: number, col: number): number | null => {
      if (!showDistanceLevels || !selectedConstraintId || !solution?.distanceLevels?.[selectedConstraintId]) {
        return null;
      }
      return solution.distanceLevels[selectedConstraintId][row][col];
    },
    [showDistanceLevels, selectedConstraintId, solution]
  );

  // Helper to get min distance constraint for a cell
  const getMinDistanceConstraint = useCallback(
    (row: number, col: number): number | null => {
      if (!distanceConstraint?.minDistances) {
        return null;
      }
      const cellKey = `${row},${col}`;
      return distanceConstraint.minDistances[cellKey] ?? null;
    },
    [distanceConstraint]
  );

  // Helper to get color for a cell
  const getCellColor = (row: number, col: number): string => {
    const inputColor = grid.colors[row][col];
    const displayColor = showSolutionColors
      ? solution!.assignedColors[row][col]
      : inputColor;
    const isBlank = inputColor === null && !showSolutionColors;
    const isHatch = displayColor === HATCH_COLOR;

    if (isBlank) {
      return "url(#blankPattern)";
    } else if (isHatch) {
      return "url(#hatchPattern)";
    } else {
      return COLORS[(displayColor ?? 0) % COLORS.length];
    }
  };

  // Pre-compute all Cairo tile data
  interface CairoData {
    row: number;
    col: number;
    path: string;
    fill: string;
    centroid: [number, number];
    reachLevel: number | null;
    isRoot: boolean;
    minDistConstraint: number | null;
  }

  const cairoData: CairoData[] = [];

  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const tile = getCairoTile(row, col);
      const svgTile = tile.map(toSvg);
      const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
      const fill = getCellColor(row, col);
      const centroid = toSvg(polyCentroid(tile));

      const reachLevel = getDistanceLevel(row, col);
      const isRoot = isRootCell(row, col);
      const minDistConstraint = getMinDistanceConstraint(row, col);

      cairoData.push({ row, col, path, fill, centroid, reachLevel, isRoot, minDistConstraint });
    }
  }

  // Pre-compute walls between tiles
  interface CairoWall {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  const cairoWalls: CairoWall[] = [];
  const processedEdges = new Set<string>();

  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const tile = getCairoTile(row, col);
      const neighbors = getCairoNeighborsWithDirection(row, col);

      for (const [nRow, nCol] of neighbors) {
        if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
          continue;
        }

        const edgeKey = row < nRow || (row === nRow && col < nCol)
          ? `${row},${col}-${nRow},${nCol}`
          : `${nRow},${nCol}-${row},${col}`;

        if (processedEdges.has(edgeKey)) {
          continue;
        }
        processedEdges.add(edgeKey);

        if (hasWall(row, col, nRow, nCol)) {
          const neighborTile = getCairoTile(nRow, nCol);
          const sharedEdge = findSharedEdge(tile, neighborTile);

          if (sharedEdge) {
            const [p1, p2] = sharedEdge.map(toSvg);
            cairoWalls.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
          }
        }
      }
    }
  }

  return (
    <div
      className="grid-container"
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        position: "relative",
        userSelect: "none",
      }}
    >
      <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
        <defs>
          <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
            <rect width="10" height="10" fill="#f5f5f5"/>
            <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
          </pattern>
          <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="#fffde7"/>
            <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
          </pattern>
        </defs>

        {/* First pass: render all Cairo tile fills */}
        {cairoData.map(({ row, col, path, fill }) => (
          <path
            key={`fill-${row}-${col}`}
            d={path}
            fill={fill}
            style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
            onMouseDown={() => onCellClick(row, col)}
            onMouseEnter={() => onCellDrag(row, col)}
          />
        ))}

        {/* Second pass: render all walls on top */}
        {cairoWalls.map((wall, i) => (
          <line
            key={`wall-${i}`}
            x1={wall.x1}
            y1={wall.y1}
            x2={wall.x2}
            y2={wall.y2}
            stroke={WALL_COLOR}
            strokeWidth={wallThickness}
            strokeLinecap="round"
          />
        ))}

        {/* Third pass: render distance levels on top of everything */}
        {cairoData.map(({ row, col, centroid, reachLevel }) =>
          reachLevel !== null && (
            <text
              key={`level-${row}-${col}`}
              x={centroid[0]}
              y={centroid[1]}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontWeight="bold"
              fontSize={cellSize > 30 ? "14px" : "10px"}
              style={{
                textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                pointerEvents: "none",
              }}
            >
              {reachLevel === -1 ? "∞" : reachLevel}
            </text>
          )
        )}

        {/* Fourth pass: render root indicators (show R when not displaying levels) */}
        {cairoData.map(({ row, col, centroid, reachLevel, isRoot }) =>
          isRoot && reachLevel === null && (
            <g key={`root-${row}-${col}`}>
              <circle
                cx={centroid[0]}
                cy={centroid[1]}
                r={cellSize * 0.2}
                fill="white"
                stroke="#2c3e50"
                strokeWidth="2"
                style={{ pointerEvents: "none" }}
              />
              <text
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#2c3e50"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "12px" : "8px"}
                style={{ pointerEvents: "none" }}
              >
                R
              </text>
            </g>
          )
        )}

        {/* Fifth pass: render min distance constraint markers */}
        {cairoData.map(({ row, col, centroid, minDistConstraint, isRoot }) =>
          minDistConstraint !== null && !isRoot && (
            <g key={`mindist-${row}-${col}`}>
              <rect
                x={centroid[0] - cellSize * 0.25}
                y={centroid[1] - cellSize * 0.15}
                width={cellSize * 0.5}
                height={cellSize * 0.3}
                rx={3}
                fill="rgba(231, 76, 60, 0.85)"
                stroke="white"
                strokeWidth="1.5"
                style={{ pointerEvents: "none" }}
              />
              <text
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "10px" : "8px"}
                style={{ pointerEvents: "none" }}
              >
                ≥{minDistConstraint}
              </text>
            </g>
          )
        )}
      </svg>
    </div>
  );
};
