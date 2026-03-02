import { type ToolType } from "./OrbifoldGridTools";

interface ToolSelectorProps {
  tool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onRandomSpanningTree: () => void;
  onToggleLoopFinder: () => void;
  showLoopFinder: boolean;
  onToggleLoopsFinder: () => void;
  showLoopsFinder: boolean;
  onTogglePathFinder: () => void;
  showPathFinder: boolean;
  onToggleParallelizable: () => void;
  showParallelizable: boolean;
  onClear: () => void;
}

export function ToolSelector({
  tool,
  onToolChange,
  onRandomSpanningTree,
  onToggleLoopFinder,
  showLoopFinder,
  onToggleLoopsFinder,
  showLoopsFinder,
  onTogglePathFinder,
  showPathFinder,
  onToggleParallelizable,
  showParallelizable,
  onClear,
}: ToolSelectorProps) {
  return (
    <>
      <div style={{ 
        display: "flex", 
        gap: "8px", 
        marginBottom: "10px",
      }}>
        <button
          onClick={() => onToolChange("color")}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: tool === "color" ? "2px solid #3498db" : "1px solid #ccc",
            backgroundColor: tool === "color" ? "#ebf5fb" : "white",
            cursor: "pointer",
            fontWeight: tool === "color" ? "bold" : "normal",
          }}
        >
          🎨 Color
        </button>
        <button
          onClick={() => onToolChange("inspect")}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: tool === "inspect" ? "2px solid #3498db" : "1px solid #ccc",
            backgroundColor: tool === "inspect" ? "#ebf5fb" : "white",
            cursor: "pointer",
            fontWeight: tool === "inspect" ? "bold" : "normal",
          }}
        >
          🔍 Inspect
        </button>
        <button
          onClick={() => onToolChange("root")}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: tool === "root" ? "2px solid #e67e22" : "1px solid #ccc",
            backgroundColor: tool === "root" ? "#fef5e7" : "white",
            cursor: "pointer",
            fontWeight: tool === "root" ? "bold" : "normal",
          }}
          title="Click a node to set it as the root for loop finding"
        >
          📌 Root
        </button>
        <button
          onClick={onRandomSpanningTree}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: "1px solid #27ae60",
            backgroundColor: "#e8f6ef",
            cursor: "pointer",
          }}
          title="Generate a random spanning tree of white nodes (solid = in tree, dashed = not in tree)"
        >
          🌲 Random Tree
        </button>
        <button
          onClick={onToggleLoopFinder}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: showLoopFinder ? "2px solid #8e44ad" : "1px solid #8e44ad",
            backgroundColor: showLoopFinder ? "#f4ecf7" : "#faf5ff",
            cursor: "pointer",
            fontWeight: showLoopFinder ? "bold" : "normal",
          }}
          title="Find a non-self-intersecting loop with target voltage via SAT solver"
        >
          🔄 Find Loop
        </button>
        <button
          onClick={onToggleLoopsFinder}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: showLoopsFinder ? "2px solid #2980b9" : "1px solid #2980b9",
            backgroundColor: showLoopsFinder ? "#d6eaf8" : "#eaf2f8",
            cursor: "pointer",
            fontWeight: showLoopsFinder ? "bold" : "normal",
          }}
          title="Find all non-self-intersecting loops across all voltages via SAT solver"
        >
          🔄 Find Loops
        </button>
        <button
          onClick={onTogglePathFinder}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: showPathFinder ? "2px solid #e67e22" : "1px solid #e67e22",
            backgroundColor: showPathFinder ? "#fdf2e9" : "#fef5e7",
            cursor: "pointer",
            fontWeight: showPathFinder ? "bold" : "normal",
          }}
          title="Find nonbranching paths where every node has exactly 0 or 2 solid edges"
        >
          🛤️ Find Nonbranching Paths
        </button>
        <button
          onClick={onToggleParallelizable}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: showParallelizable ? "2px solid #27ae60" : "1px solid #27ae60",
            backgroundColor: showParallelizable ? "#eafaf1" : "#f9fefe",
            cursor: "pointer",
            fontWeight: showParallelizable ? "bold" : "normal",
          }}
          title="Check if the current path is parallelizable and display the region partition"
        >
          🔲 Parallelizable
        </button>
        <button
          onClick={onClear}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: "1px solid #e74c3c",
            backgroundColor: "#fdedec",
            cursor: "pointer",
          }}
          title="Reset all nodes to white and all edges to solid"
        >
          🧹 Clear
        </button>
      </div>
      
      <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
        {tool === "color" 
          ? "Click cells to toggle black/white" 
          : tool === "root"
          ? "Click a node to set it as root"
          : "Click cells to inspect node info and voltages"}
      </p>
    </>
  );
}
