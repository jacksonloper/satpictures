import { ValidatedInput } from "./ValidatedInput";

interface PathFinderPanelProps {
  minNodes: number;
  onMinNodesChange: (value: number) => void;
  solvingPath: boolean;
  onSolvePath: () => void;
  onCancel: () => void;
  pathSatStats: { numVars: number; numClauses: number } | null;
}

export function PathFinderPanel({
  minNodes,
  onMinNodesChange,
  solvingPath,
  onSolvePath,
  onCancel,
  pathSatStats,
}: PathFinderPanelProps) {
  return (
    <div style={{
      marginBottom: "10px",
      padding: "10px",
      backgroundColor: "#fdf2e9",
      borderRadius: "8px",
      border: "1px solid #e67e22",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
        <ValidatedInput
          value={minNodes}
          onChange={onMinNodesChange}
          min={1}
          max={9999}
          label="Min nodes"
          disabled={solvingPath}
        />
        <button
          onClick={onSolvePath}
          disabled={solvingPath}
          style={{
            padding: "4px 12px",
            borderRadius: "4px",
            border: "1px solid #e67e22",
            backgroundColor: solvingPath ? "#d5d8dc" : "#fdebd0",
            cursor: solvingPath ? "not-allowed" : "pointer",
            fontSize: "13px",
          }}
        >
          {solvingPath ? "Solving…" : "Find"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "4px 12px",
            borderRadius: "4px",
            border: "1px solid #e74c3c",
            backgroundColor: "#fadbd8",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Cancel
        </button>
      </div>

      <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
        Finds edge assignments where every node has exactly 0 or 2 solid edges (nonbranching paths/cycles).
      </p>

      {pathSatStats && (
        <p style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
          SAT: {pathSatStats.numVars} vars, {pathSatStats.numClauses} clauses
        </p>
      )}
    </div>
  );
}
