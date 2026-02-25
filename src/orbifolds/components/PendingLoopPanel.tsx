/**
 * Pending loop result panel - accept or reject with 2D preview.
 */

import type { OrbifoldGrid } from "../orbifoldbasics";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";
import { DoubledOrbifoldLoopDisplay } from "./DoubledOrbifoldLoopDisplay";

export interface PendingLoopResult {
  pathNodeIds: string[];
  loopEdgeIds: string[];
  pathEdgeIds?: string[];
}

export interface PendingLoopPanelProps {
  pendingLoopResult: PendingLoopResult;
  doubledGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  onAccept: () => void;
  onReject: () => void;
}

export function PendingLoopPanel({
  pendingLoopResult,
  doubledGrid,
  onAccept,
  onReject,
}: PendingLoopPanelProps) {
  return (
    <div style={{
      marginBottom: "16px",
      padding: "16px",
      backgroundColor: "#fef9e7",
      borderRadius: "8px",
      border: "1px solid #f39c12",
    }}>
      <h3 style={{ marginBottom: "12px" }}>🔍 Loop Found — Review</h3>
      <p style={{ fontSize: "13px", marginBottom: "12px" }}>
        Path: {pendingLoopResult.pathNodeIds.length} nodes, {pendingLoopResult.loopEdgeIds.length} edges in loop
      </p>

      <DoubledOrbifoldLoopDisplay
        doubledGrid={doubledGrid}
        pathNodeIds={pendingLoopResult.pathNodeIds}
      />

      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button
          onClick={onAccept}
          style={{
            padding: "6px 16px",
            borderRadius: "4px",
            border: "1px solid #27ae60",
            backgroundColor: "#d5f5e3",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
          }}
        >
          ✓ Accept
        </button>
        <button
          onClick={onReject}
          style={{
            padding: "6px 16px",
            borderRadius: "4px",
            border: "1px solid #e74c3c",
            backgroundColor: "#fadbd8",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}
