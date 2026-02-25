interface TilingStatusDisplayProps {
  solving: boolean;
  tilingStats: { numVars: number; numClauses: number } | null;
  tilingError: string | null;
}

export function TilingStatusDisplay({
  solving,
  tilingStats,
  tilingError,
}: TilingStatusDisplayProps) {
  return (
    <>
      {/* Progress/Stats display */}
      {solving && tilingStats && (
        <div
          style={{
            padding: "12px",
            backgroundColor: "#e8f4fd",
            borderRadius: "4px",
            marginBottom: "12px",
            fontSize: "14px",
          }}
        >
          <strong>Solving...</strong>{" "}
          {tilingStats.numVars.toLocaleString()} variables,{" "}
          {tilingStats.numClauses.toLocaleString()} clauses
        </div>
      )}

      {/* Error display */}
      {tilingError && (
        <div
          style={{
            padding: "12px",
            backgroundColor: "#fdecea",
            borderRadius: "4px",
            marginBottom: "12px",
            color: "#e74c3c",
            fontSize: "14px",
          }}
        >
          ❌ {tilingError}
        </div>
      )}
    </>
  );
}
