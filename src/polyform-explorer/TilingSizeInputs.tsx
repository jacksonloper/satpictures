interface TilingSizeInputsProps {
  tilingWidthInput: string;
  tilingHeightInput: string;
  tilingWidthError: boolean;
  tilingHeightError: boolean;
  solving: boolean;
  onTilingWidthInputChange: (value: string) => void;
  onTilingHeightInputChange: (value: string) => void;
  onTilingWidthBlur: () => void;
  onTilingHeightBlur: () => void;
  setTilingWidthError: (value: boolean) => void;
  setTilingHeightError: (value: boolean) => void;
  onSolveTiling: () => void;
  onCancelSolving: () => void;
}

export function TilingSizeInputs({
  tilingWidthInput,
  tilingHeightInput,
  tilingWidthError,
  tilingHeightError,
  solving,
  onTilingWidthInputChange,
  onTilingHeightInputChange,
  onTilingWidthBlur,
  onTilingHeightBlur,
  setTilingWidthError,
  setTilingHeightError,
  onSolveTiling,
  onCancelSolving,
}: TilingSizeInputsProps) {
  return (
    <div
      style={{
        marginBottom: "16px",
        display: "flex",
        gap: "20px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <div>
        <label style={{ marginRight: "8px" }}>Tiling Width:</label>
        <input
          type="text"
          value={tilingWidthInput}
          onChange={(e) => {
            onTilingWidthInputChange(e.target.value);
            setTilingWidthError(false);
          }}
          onBlur={onTilingWidthBlur}
          disabled={solving}
          style={{
            width: "60px",
            padding: "8px",
            fontSize: "14px",
            borderRadius: "4px",
            border: tilingWidthError
              ? "2px solid #e74c3c"
              : "1px solid #bdc3c7",
            backgroundColor: tilingWidthError ? "#fdecea" : "white",
          }}
        />
        {tilingWidthError && (
          <span
            style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}
          >
            Enter an integer (1-50)
          </span>
        )}
      </div>
      <div>
        <label style={{ marginRight: "8px" }}>Tiling Height:</label>
        <input
          type="text"
          value={tilingHeightInput}
          onChange={(e) => {
            onTilingHeightInputChange(e.target.value);
            setTilingHeightError(false);
          }}
          onBlur={onTilingHeightBlur}
          disabled={solving}
          style={{
            width: "60px",
            padding: "8px",
            fontSize: "14px",
            borderRadius: "4px",
            border: tilingHeightError
              ? "2px solid #e74c3c"
              : "1px solid #bdc3c7",
            backgroundColor: tilingHeightError ? "#fdecea" : "white",
          }}
        />
        {tilingHeightError && (
          <span
            style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}
          >
            Enter an integer (1-50)
          </span>
        )}
      </div>
      <button
        onClick={onSolveTiling}
        disabled={solving}
        style={{
          padding: "8px 20px",
          backgroundColor: solving ? "#95a5a6" : "#27ae60",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: solving ? "not-allowed" : "pointer",
          fontWeight: "bold",
        }}
      >
        {solving ? "⏳ Solving..." : "🔍 Solve Tiling"}
      </button>
      {solving && (
        <button
          onClick={onCancelSolving}
          style={{
            padding: "8px 20px",
            backgroundColor: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ❌ Cancel
        </button>
      )}
    </div>
  );
}
