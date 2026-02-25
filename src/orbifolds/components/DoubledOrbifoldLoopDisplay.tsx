/**
 * 2D visualization of a loop path on a doubled orbifold.
 * Shows level 0 (low) and level 1 (high) views side by side.
 */

import { useMemo } from "react";
import type { OrbifoldGrid } from "../orbifoldbasics";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";
import { getLevelFromNodeId } from "../doubleOrbifold";

export interface DoubledOrbifoldLoopDisplayProps {
  doubledGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  pathNodeIds: string[];
  onNodeClick?: (nodeId: string) => void;
  highlightedNodeId?: string | null;
}

/**
 * Render two 2D views (level 0 and level 1) of the doubled orbifold,
 * showing only nodes (no edges) with their step number in the loop path.
 * Nodes not in the loop are shown as small grey dots.
 */
export function DoubledOrbifoldLoopDisplay({
  doubledGrid,
  pathNodeIds,
  onNodeClick,
  highlightedNodeId,
}: DoubledOrbifoldLoopDisplayProps) {
  // Build a map from nodeId → step number (1-based)
  const nodeStep = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < pathNodeIds.length; i++) {
      // If a node appears more than once (start == end), keep the first
      if (!map.has(pathNodeIds[i])) {
        map.set(pathNodeIds[i], i + 1);
      }
    }
    return map;
  }, [pathNodeIds]);

  // Collect nodes per level
  const levelNodes = useMemo(() => {
    const byLevel: [typeof nodes0, typeof nodes1] = [[], []];
    type NodeInfo = { id: string; x: number; y: number; step: number | null };
    const nodes0: NodeInfo[] = [];
    const nodes1: NodeInfo[] = [];
    byLevel[0] = nodes0;
    byLevel[1] = nodes1;
    for (const [nodeId, node] of doubledGrid.nodes) {
      const level = getLevelFromNodeId(nodeId);
      if (level === undefined) continue;
      const step = nodeStep.get(nodeId) ?? null;
      const entry = { id: nodeId, x: node.coord[0], y: node.coord[1], step };
      byLevel[level].push(entry);
    }
    return byLevel;
  }, [doubledGrid, nodeStep]);

  const cellSize = 36;
  const padding = 24;

  return (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      {([0, 1] as const).map((level) => {
        const nodes = levelNodes[level];
        if (nodes.length === 0) return null;
        const xs = nodes.map(n => n.x);
        const ys = nodes.map(n => n.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const svgW = rangeX * cellSize / 2 + 2 * padding + 30;
        const svgH = rangeY * cellSize / 2 + 2 * padding + 30;

        const toSvgX = (c: number) => ((c - minX) * cellSize / 2) + padding + 15;
        const toSvgY = (c: number) => ((c - minY) * cellSize / 2) + padding + 15;

        return (
          <div key={level}>
            <h4 style={{ marginBottom: "4px", fontSize: "13px" }}>
              Level {level} ({level === 0 ? "Low" : "High"})
            </h4>
            <svg
              width={Math.min(svgW, 350)}
              height={Math.min(svgH, 350)}
              viewBox={`0 0 ${svgW} ${svgH}`}
              style={{
                border: "1px solid #ccc",
                borderRadius: "4px",
                backgroundColor: level === 0 ? "#f0fafa" : "#fef8f0",
              }}
            >
              {nodes.map((nd) => {
                const cx = toSvgX(nd.x);
                const cy = toSvgY(nd.y);
                if (nd.step !== null) {
                  // Node is in the loop — draw a filled circle with step number
                  const fill = level === 0 ? "#00838f" : "#ff8c00";
                  const isHighlighted = nd.id === highlightedNodeId;
                  return (
                    <g
                      key={nd.id}
                      onClick={() => onNodeClick?.(nd.id)}
                      style={{ cursor: onNodeClick ? "pointer" : undefined }}
                    >
                      {isHighlighted && (
                        <circle cx={cx} cy={cy} r={16} fill="none" stroke="#FFD700" strokeWidth={3} />
                      )}
                      <circle cx={cx} cy={cy} r={11} fill={fill} stroke={isHighlighted ? "#FFD700" : "#333"} strokeWidth={isHighlighted ? 2 : 1} />
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="9"
                        fontWeight="bold"
                        fill="#fff"
                      >
                        {nd.step}
                      </text>
                    </g>
                  );
                } else {
                  // Node not in loop — small grey dot
                  return (
                    <circle
                      key={nd.id}
                      cx={cx}
                      cy={cy}
                      r={3}
                      fill="#ccc"
                      stroke="#999"
                      strokeWidth={0.5}
                    />
                  );
                }
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
