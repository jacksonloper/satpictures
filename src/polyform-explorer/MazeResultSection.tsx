import type { RefObject } from "react";
import type { PolyformType } from "../utils/polyformTransforms";
import {
  MazeViewer,
  HexMazeViewer,
  TriMazeViewer,
  type MazeResult,
  type HexMazeResult,
  type TriMazeResult,
} from "../polyform-explorer";

export interface MazeResultSectionProps {
  solvedPolyformType: PolyformType | null;
  tilingWidth: number;
  tilingHeight: number;
  mazeResult: MazeResult | null;
  hexMazeResult: HexMazeResult | null;
  triMazeResult: TriMazeResult | null;
  mazeSvgRef: RefObject<SVGSVGElement | null>;
  onDownloadMazeSvg: () => void;
}

export function MazeResultSection({
  solvedPolyformType,
  tilingWidth,
  tilingHeight,
  mazeResult,
  hexMazeResult,
  triMazeResult,
  mazeSvgRef,
  onDownloadMazeSvg,
}: MazeResultSectionProps) {
  return (
    <>
      {/* Maze Result Display (polyomino) */}
      {mazeResult && solvedPolyformType === "polyomino" && (
        <div style={{ 
          marginTop: "24px", 
          padding: "16px", 
          backgroundColor: "#f0f8ff", 
          borderRadius: "8px",
          border: "2px solid #9b59b6",
        }}>
          <h4 style={{ marginTop: 0, marginBottom: "12px", color: "#9b59b6" }}>
            🌲 Generated Maze
          </h4>
          <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "12px" }}>
            A spanning tree connects all tile placements. One wall has been randomly opened 
            for each edge in the spanning tree, creating a maze.
          </p>
          <MazeViewer
            width={tilingWidth}
            height={tilingHeight}
            walls={mazeResult.remainingWalls}
            svgRef={mazeSvgRef}
          />
          <div style={{ marginTop: "12px", fontSize: "14px", color: "#495057" }}>
            <strong>{mazeResult.remainingWalls.length}</strong> walls remaining 
            ({mazeResult.spanningTreeEdges.length} walls opened via spanning tree)
          </div>
          <button
            onClick={onDownloadMazeSvg}
            style={{
              marginTop: "12px",
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            💾 Save Maze as SVG
          </button>
        </div>
      )}
      
      {/* Hex Maze Result Display (polyhex) */}
      {hexMazeResult && solvedPolyformType === "polyhex" && (
        <div style={{ 
          marginTop: "24px", 
          padding: "16px", 
          backgroundColor: "#f0f8ff", 
          borderRadius: "8px",
          border: "2px solid #9b59b6",
        }}>
          <h4 style={{ marginTop: 0, marginBottom: "12px", color: "#9b59b6" }}>
            🌲 Generated Hex Maze
          </h4>
          <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "12px" }}>
            A spanning tree connects all tile placements. One wall has been randomly opened 
            for each edge in the spanning tree, creating a maze.
          </p>
          <HexMazeViewer
            width={tilingWidth}
            height={tilingHeight}
            walls={hexMazeResult.remainingWalls}
            svgRef={mazeSvgRef}
          />
          <div style={{ marginTop: "12px", fontSize: "14px", color: "#495057" }}>
            <strong>{hexMazeResult.remainingWalls.length}</strong> walls remaining 
            ({hexMazeResult.spanningTreeEdges.length} walls opened via spanning tree)
          </div>
          <button
            onClick={onDownloadMazeSvg}
            style={{
              marginTop: "12px",
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            💾 Save Maze as SVG
          </button>
        </div>
      )}
      
      {/* Triangle Maze Result Display (polyiamond) */}
      {triMazeResult && solvedPolyformType === "polyiamond" && (
        <div style={{ 
          marginTop: "24px", 
          padding: "16px", 
          backgroundColor: "#f0f8ff", 
          borderRadius: "8px",
          border: "2px solid #9b59b6",
        }}>
          <h4 style={{ marginTop: 0, marginBottom: "12px", color: "#9b59b6" }}>
            🌲 Generated Triangle Maze
          </h4>
          <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "12px" }}>
            A spanning tree connects all tile placements. One wall has been randomly opened 
            for each edge in the spanning tree, creating a maze.
          </p>
          <TriMazeViewer
            width={tilingWidth}
            height={tilingHeight}
            walls={triMazeResult.remainingWalls}
            svgRef={mazeSvgRef}
          />
          <div style={{ marginTop: "12px", fontSize: "14px", color: "#495057" }}>
            <strong>{triMazeResult.remainingWalls.length}</strong> walls remaining 
            ({triMazeResult.spanningTreeEdges.length} walls opened via spanning tree)
          </div>
          <button
            onClick={onDownloadMazeSvg}
            style={{
              marginTop: "12px",
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            💾 Save Maze as SVG
          </button>
        </div>
      )}
    </>
  );
}
