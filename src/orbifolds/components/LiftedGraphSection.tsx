import type { RefObject } from "react";
import { LiftedGraphRenderer, type BackgroundMode } from "./LiftedGraphRenderer";
import type { LiftedGraph } from "../orbifoldbasics";
import type { ColorData, EdgeStyleData, WallpaperGroupType } from "../createOrbifolds";
import type { OrbifoldGrid } from "../orbifoldbasics";

interface LiftedGraphSectionProps {
  wallpaperGroup: WallpaperGroupType;
  useAxialTransform: boolean;
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  inspectedNodeId: string | null;
  selectedVoltageKey: string | null;
  onNodeClick: (liftedNodeId: string, voltageKey: string) => void;
  backgroundMode: BackgroundMode;
  onBackgroundModeChange: (mode: BackgroundMode) => void;
  showDashedLines: boolean;
  onShowDashedLinesChange: (value: boolean) => void;
  showNodes: boolean;
  onShowNodesChange: (value: boolean) => void;
  showWalls: boolean;
  onShowWallsChange: (value: boolean) => void;
  onExportSvg: () => void;
  svgRef: RefObject<SVGSVGElement | null>;
}

export function LiftedGraphSection({
  wallpaperGroup,
  useAxialTransform,
  liftedGraph,
  orbifoldGrid,
  inspectedNodeId,
  selectedVoltageKey,
  onNodeClick,
  backgroundMode,
  onBackgroundModeChange,
  showDashedLines,
  onShowDashedLinesChange,
  showNodes,
  onShowNodesChange,
  showWalls,
  onShowWallsChange,
  onExportSvg,
  svgRef,
}: LiftedGraphSectionProps) {
  return (
    <div>
      <h3 style={{ marginBottom: "10px" }}>Lifted Graph{(wallpaperGroup === "P3" || wallpaperGroup === "P6") && useAxialTransform ? " (Axial → Cartesian)" : ""}</h3>
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
        Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
        {inspectedNodeId && (
          <span style={{ color: "#3498db", marginLeft: "8px" }}>
            (highlighted: {inspectedNodeId})
          </span>
        )}
      </p>
      
      {/* Display options */}
      <div style={{ 
        display: "flex", 
        flexWrap: "wrap",
        gap: "16px", 
        marginBottom: "10px",
        fontSize: "12px",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <label>Background:</label>
          <select
            value={backgroundMode}
            onChange={(e) => onBackgroundModeChange(e.target.value as BackgroundMode)}
            style={{
              padding: "2px 4px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              fontSize: "12px",
            }}
          >
            <option value="none">No background</option>
            <option value="domain">Color by fundamental domain</option>
            <option value="component">Color by connected component</option>
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showDashedLines}
            onChange={(e) => onShowDashedLinesChange(e.target.checked)}
          />
          Show dashed lines
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showNodes}
            onChange={(e) => onShowNodesChange(e.target.checked)}
          />
          Show nodes
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showWalls}
            onChange={(e) => onShowWallsChange(e.target.checked)}
          />
          Show walls
        </label>
        <button
          onClick={onExportSvg}
          style={{
            padding: "4px 10px",
            borderRadius: "4px",
            border: "1px solid #3498db",
            backgroundColor: "#ebf5fb",
            cursor: "pointer",
            fontSize: "12px",
          }}
          title="Download lifted graph as SVG file"
        >
          💾 Save SVG
        </button>
      </div>
      
      <LiftedGraphRenderer
        liftedGraph={liftedGraph}
        orbifoldGrid={orbifoldGrid}
        highlightOrbifoldNodeId={inspectedNodeId ?? undefined}
        useAxialTransform={(wallpaperGroup === "P3" || wallpaperGroup === "P6") && useAxialTransform}
        selectedVoltageKey={selectedVoltageKey}
        onNodeClick={onNodeClick}
        showDomains={backgroundMode}
        showDashedLines={showDashedLines}
        showNodes={showNodes}
        showWalls={showWalls}
        svgRef={svgRef}
        wallpaperGroup={wallpaperGroup}
      />
      
      {/* Legend */}
      <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
        <p>
          {showNodes && (
            <>
              <span style={{ color: "#27ae60" }}>●</span> Interior nodes
              <span style={{ marginLeft: "16px", color: "#e74c3c" }}>○</span> Exterior nodes
              {inspectedNodeId && (
                <>
                  <span style={{ marginLeft: "16px", color: "#3498db" }}>◉</span> Highlighted
                </>
              )}
            </>
          )}
          {selectedVoltageKey && (
            <>
              <span style={{ marginLeft: showNodes ? "16px" : "0" }}>▢</span> Selected domain (click node to highlight)
            </>
          )}
        </p>
        {showNodes && (
          <p style={{ marginTop: "4px" }}>
            Click on a lifted node to highlight its fundamental domain.
          </p>
        )}
      </div>
    </div>
  );
}
