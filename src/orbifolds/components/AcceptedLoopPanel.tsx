/**
 * Accepted loop panel - shows 2D cross-reference and 3D lifted graph.
 */

import type { OrbifoldGrid, LiftedGraph } from "../orbifoldbasics";
import type { ColorData, EdgeStyleData, WallpaperGroupType } from "../createOrbifolds";
import { DoubledOrbifoldLoopDisplay } from "./DoubledOrbifoldLoopDisplay";
import { ErrorBoundary } from "./ErrorBoundary";
import { WeaveThreeRenderer } from "./WeaveThreeRenderer";

export interface AcceptedLoopPanelProps {
  doubledGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  acceptedPathNodeIds: string[];
  highlightedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  wallpaperGroup: WallpaperGroupType;
  levelHeight: number;
  tubeRadius: number;
  beadSpeed: number;
  onLevelHeightChange: (v: number) => void;
  onTubeRadiusChange: (v: number) => void;
  onBeadSpeedChange: (v: number) => void;
}

export function AcceptedLoopPanel({
  doubledGrid,
  acceptedPathNodeIds,
  highlightedNodeId,
  onNodeClick,
  liftedGraph,
  wallpaperGroup,
  levelHeight,
  tubeRadius,
  beadSpeed,
  onLevelHeightChange,
  onTubeRadiusChange,
  onBeadSpeedChange,
}: AcceptedLoopPanelProps) {
  return (
    <div>
      <h3 style={{ marginBottom: "10px" }}>Loop Path (Cross Reference)</h3>
      <DoubledOrbifoldLoopDisplay
        doubledGrid={doubledGrid}
        pathNodeIds={acceptedPathNodeIds}
        onNodeClick={onNodeClick}
        highlightedNodeId={highlightedNodeId}
      />

      <h3 style={{ marginTop: "20px", marginBottom: "10px" }}>3D Weave (Lifted Graph)</h3>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
        Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
      </p>
      <div style={{ display: "flex", gap: "20px", marginBottom: "10px", fontSize: "13px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          Level height:
          <input
            type="range"
            min={0}
            max={6}
            step={0.1}
            value={levelHeight}
            onChange={(e) => onLevelHeightChange(parseFloat(e.target.value))}
            style={{ width: "120px" }}
          />
          <span style={{ minWidth: "32px" }}>{levelHeight.toFixed(1)}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          Tube radius:
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={tubeRadius}
            onChange={(e) => onTubeRadiusChange(parseFloat(e.target.value))}
            style={{ width: "120px" }}
          />
          <span style={{ minWidth: "32px" }}>{tubeRadius.toFixed(2)}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          Bead speed:
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={beadSpeed}
            onChange={(e) => onBeadSpeedChange(parseFloat(e.target.value))}
            style={{ width: "120px" }}
          />
          <span style={{ minWidth: "32px" }}>{beadSpeed.toFixed(1)}</span>
        </label>
      </div>
      <ErrorBoundary>
        <WeaveThreeRenderer
          liftedGraph={liftedGraph}
          orbifoldGrid={doubledGrid}
          useAxialTransform={wallpaperGroup === "P3" || wallpaperGroup === "P6"}
          highlightedOrbifoldNodeId={highlightedNodeId}
          levelSpacing={levelHeight}
          tubeRadius={tubeRadius}
          beadSpeed={beadSpeed}
        />
      </ErrorBoundary>
    </div>
  );
}
