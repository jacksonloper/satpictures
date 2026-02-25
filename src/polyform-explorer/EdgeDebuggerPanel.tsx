import type { UnifiedEdgeInfo } from "../polyform-explorer";

interface EdgeDebuggerPanelProps {
  allEdges: UnifiedEdgeInfo[];
  selectedEdgeIndex: number | null;
  showDebugSide: "A" | "B";
  edgeFilter: "all" | "violations" | "consistent";
  setSelectedEdgeIndex: (value: number | null) => void;
  setShowDebugSide: (value: "A" | "B") => void;
  setEdgeFilter: (value: "all" | "violations" | "consistent") => void;
}

export function EdgeDebuggerPanel({
  allEdges,
  selectedEdgeIndex,
  showDebugSide,
  edgeFilter,
  setSelectedEdgeIndex,
  setShowDebugSide,
  setEdgeFilter,
}: EdgeDebuggerPanelProps) {
  if (allEdges.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        padding: "12px",
        backgroundColor: "#e7f3ff",
        border: "1px solid #b6d4fe",
        borderRadius: "4px",
        marginBottom: "12px",
        fontSize: "12px",
      }}
    >
      <strong>🔍 Edge Debugger</strong>
      <span style={{ marginLeft: "8px", color: "#666" }}>
        ({allEdges.length} edges total,{" "}
        {allEdges.filter((e) => !e.isConsistent).length} violations)
      </span>
      <div style={{ marginTop: "8px" }}>
        <label style={{ marginRight: "8px" }}>Filter:</label>
        <select
          value={edgeFilter}
          onChange={(e) => {
            setEdgeFilter(
              e.target.value as "all" | "violations" | "consistent"
            );
            setSelectedEdgeIndex(null);
          }}
          style={{ marginRight: "16px" }}
        >
          <option value="all">All edges ({allEdges.length})</option>
          <option value="violations">
            Violations only (
            {allEdges.filter((e) => !e.isConsistent).length})
          </option>
          <option value="consistent">
            Consistent only (
            {allEdges.filter((e) => e.isConsistent).length})
          </option>
        </select>

        <label style={{ marginRight: "8px" }}>Select edge:</label>
        <select
          value={selectedEdgeIndex ?? ""}
          onChange={(e) =>
            setSelectedEdgeIndex(
              e.target.value === "" ? null : Number(e.target.value)
            )
          }
          style={{ maxWidth: "350px" }}
        >
          <option value="">-- Choose an edge --</option>
          {allEdges
            .map((e, i) => ({ edge: e, originalIndex: i }))
            .filter(({ edge }) =>
              edgeFilter === "all"
                ? true
                : edgeFilter === "violations"
                  ? !edge.isConsistent
                  : edge.isConsistent
            )
            .map(({ edge, originalIndex }) => (
              <option key={originalIndex} value={originalIndex}>
                {edge.isConsistent ? "🟢" : "🔴"} ({edge.cell1.q},
                {edge.cell1.r})#{edge.edgeIdx1} ↔ ({edge.cell2.q},
                {edge.cell2.r})#{edge.edgeIdx2}:{" "}
                {edge.value1 ? "●" : "○"} vs{" "}
                {edge.value2 ? "●" : "○"}
              </option>
            ))}
        </select>
      </div>

      {selectedEdgeIndex !== null &&
        allEdges[selectedEdgeIndex] && (
          <div
            style={{
              marginTop: "8px",
              padding: "8px",
              backgroundColor: "#fff",
              borderRadius: "4px",
            }}
          >
            <div style={{ marginBottom: "4px" }}>
              <strong>Toggle side:</strong>{" "}
              <button
                onClick={() => setShowDebugSide("A")}
                style={{
                  marginRight: "4px",
                  fontWeight:
                    showDebugSide === "A" ? "bold" : "normal",
                  backgroundColor:
                    showDebugSide === "A" ? "#007bff" : "#e9ecef",
                  color:
                    showDebugSide === "A" ? "#fff" : "#212529",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Side A
              </button>
              <button
                onClick={() => setShowDebugSide("B")}
                style={{
                  fontWeight:
                    showDebugSide === "B" ? "bold" : "normal",
                  backgroundColor:
                    showDebugSide === "B" ? "#007bff" : "#e9ecef",
                  color:
                    showDebugSide === "B" ? "#fff" : "#212529",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Side B
              </button>
              <span
                style={{
                  marginLeft: "12px",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  backgroundColor: allEdges[selectedEdgeIndex]
                    .isConsistent
                    ? "#d4edda"
                    : "#f8d7da",
                  color: allEdges[selectedEdgeIndex].isConsistent
                    ? "#155724"
                    : "#721c24",
                }}
              >
                {allEdges[selectedEdgeIndex].isConsistent
                  ? "✓ Consistent"
                  : "✗ Mismatch!"}
              </span>
            </div>
            <div
              style={{ fontFamily: "monospace", fontSize: "11px" }}
            >
              {showDebugSide === "A" ? (
                <>
                  <div>
                    <strong>Cell:</strong> (
                    {allEdges[selectedEdgeIndex].cell1.q},{" "}
                    {allEdges[selectedEdgeIndex].cell1.r})
                  </div>
                  <div>
                    <strong>Edge Index:</strong>{" "}
                    {allEdges[selectedEdgeIndex].edgeIdx1}
                  </div>
                  <div>
                    <strong>Filledness:</strong>{" "}
                    <span
                      style={{
                        color: allEdges[selectedEdgeIndex].value1
                          ? "green"
                          : "red",
                      }}
                    >
                      {allEdges[selectedEdgeIndex].value1
                        ? "●  FILLED"
                        : "○  UNFILLED"}
                    </span>
                  </div>
                  <div>
                    <strong>Placement:</strong> #
                    {allEdges[selectedEdgeIndex].placementIdx1}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <strong>Cell:</strong> (
                    {allEdges[selectedEdgeIndex].cell2.q},{" "}
                    {allEdges[selectedEdgeIndex].cell2.r})
                  </div>
                  <div>
                    <strong>Edge Index:</strong>{" "}
                    {allEdges[selectedEdgeIndex].edgeIdx2}
                  </div>
                  <div>
                    <strong>Filledness:</strong>{" "}
                    <span
                      style={{
                        color: allEdges[selectedEdgeIndex].value2
                          ? "green"
                          : "red",
                      }}
                    >
                      {allEdges[selectedEdgeIndex].value2
                        ? "●  FILLED"
                        : "○  UNFILLED"}
                    </span>
                  </div>
                  <div>
                    <strong>Placement:</strong> #
                    {allEdges[selectedEdgeIndex].placementIdx2}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
