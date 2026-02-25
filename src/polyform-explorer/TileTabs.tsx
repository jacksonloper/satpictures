import type { TileState } from "../PolyformExplorerHelpers";

export interface TileTabsProps {
  tiles: TileState[];
  activeTileIndex: number;
  onSelectTile: (index: number) => void;
  onAddTile: () => void;
  onRemoveTile: () => void;
}

export function TileTabs({
  tiles,
  activeTileIndex,
  onSelectTile,
  onAddTile,
  onRemoveTile,
}: TileTabsProps) {
  return (
    <div style={{ 
      marginTop: "16px",
      marginBottom: "8px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexWrap: "wrap",
    }}>
      {/* Tab buttons for each tile */}
      {tiles.map((tile, index) => {
        const tileFilledCount = tile.cells.reduce((sum, row) => 
          sum + row.filter(c => c).length, 0
        );
        return (
          <button
            key={index}
            onClick={() => onSelectTile(index)}
            style={{
              padding: "8px 16px",
              backgroundColor: index === activeTileIndex ? "#3498db" : "#e9ecef",
              color: index === activeTileIndex ? "white" : "#495057",
              border: "none",
              borderRadius: "4px 4px 0 0",
              cursor: "pointer",
              fontWeight: index === activeTileIndex ? "bold" : "normal",
              fontSize: "14px",
              transition: "background-color 0.2s",
            }}
          >
            Tile {index + 1} {tileFilledCount > 0 && `(${tileFilledCount})`}
          </button>
        );
      })}
      
      {/* Add Tile button */}
      <button
        onClick={onAddTile}
        style={{
          padding: "8px 12px",
          backgroundColor: "#27ae60",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: "bold",
        }}
        title="Add a new tile"
      >
        + Add Tile
      </button>
      
      {/* Remove Tile button (only if more than one tile) */}
      {tiles.length > 1 && (
        <button
          onClick={onRemoveTile}
          style={{
            padding: "8px 12px",
            backgroundColor: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
          }}
          title="Remove current tile"
        >
          − Remove
        </button>
      )}
    </div>
  );
}
