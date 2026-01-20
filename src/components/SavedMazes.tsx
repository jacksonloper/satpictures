import React from "react";
import type { SavedMaze } from "../storage";

interface SavedMazesProps {
  mazes: SavedMaze[];
  onRestore: (maze: SavedMaze) => void;
  onDelete: (id: string) => void;
}

export const SavedMazes: React.FC<SavedMazesProps> = ({
  mazes,
  onRestore,
  onDelete,
}) => {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  if (mazes.length === 0) {
    return (
      <div
        style={{
          padding: "12px",
          color: "#7f8c8d",
          fontSize: "14px",
          fontStyle: "italic",
        }}
      >
        No saved mazes yet. Use "Save Maze" to save your current maze.
      </div>
    );
  }

  return (
    <div
      style={{
        maxHeight: "300px",
        overflowY: "auto",
        border: "1px solid #bdc3c7",
        borderRadius: "4px",
      }}
    >
      {mazes.map((maze) => (
        <div
          key={maze.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid #ecf0f1",
            backgroundColor: "#fff",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 500,
                color: "#2c3e50",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {maze.name}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#95a5a6",
              }}
            >
              {maze.grid.width}×{maze.grid.height} {maze.gridType} · {formatDate(maze.createdAt)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "4px", marginLeft: "8px" }}>
            <button
              onClick={() => onRestore(maze)}
              style={{
                padding: "4px 8px",
                backgroundColor: "#3498db",
                color: "white",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Restore
            </button>
            <button
              onClick={() => onDelete(maze.id)}
              style={{
                padding: "4px 8px",
                backgroundColor: "#e74c3c",
                color: "white",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
