import { useState, useCallback } from 'react';
import './PolyformsPage.css';

type PolyformType = 'polyomino' | 'polyhex' | 'polyiamond';

interface Cell {
  filled: boolean;
}

function createEmptyGrid(width: number, height: number): Cell[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ filled: false }))
  );
}

function rotateGrid(grid: Cell[][]): Cell[][] {
  const height = grid.length;
  const width = grid[0].length;
  const rotated = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => ({ filled: false }))
  );

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      rotated[col][height - 1 - row] = grid[row][col];
    }
  }

  return rotated;
}

function flipGrid(grid: Cell[][]): Cell[][] {
  return grid.map(row => [...row].reverse());
}

export function PolyformsPage() {
  const [polyformType, setPolyformType] = useState<PolyformType>('polyomino');
  const [widthInput, setWidthInput] = useState('10');
  const [heightInput, setHeightInput] = useState('10');
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  const [gridWidth, setGridWidth] = useState(10);
  const [gridHeight, setGridHeight] = useState(10);
  const [grid, setGrid] = useState<Cell[][]>(() => createEmptyGrid(10, 10));
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'fill' | 'erase'>('fill');

  const handleWidthBlur = () => {
    const value = parseInt(widthInput, 10);
    if (isNaN(value) || value < 1 || value > 50) {
      setWidthError(true);
    } else {
      setWidthError(false);
      if (value !== gridWidth) {
        setGridWidth(value);
        setGrid(createEmptyGrid(value, gridHeight));
      }
    }
  };

  const handleHeightBlur = () => {
    const value = parseInt(heightInput, 10);
    if (isNaN(value) || value < 1 || value > 50) {
      setHeightError(true);
    } else {
      setHeightError(false);
      if (value !== gridHeight) {
        setGridHeight(value);
        setGrid(createEmptyGrid(gridWidth, value));
      }
    }
  };

  const handleCellMouseDown = useCallback((row: number, col: number) => {
    setIsDragging(true);
    const newFillState = !grid[row][col].filled;
    setDragMode(newFillState ? 'fill' : 'erase');
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c })));
      newGrid[row][col].filled = newFillState;
      return newGrid;
    });
  }, [grid]);

  const handleCellMouseEnter = useCallback((row: number, col: number) => {
    if (isDragging) {
      setGrid(prevGrid => {
        const newGrid = prevGrid.map(r => r.map(c => ({ ...c })));
        newGrid[row][col].filled = dragMode === 'fill';
        return newGrid;
      });
    }
  }, [isDragging, dragMode]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleRotate = () => {
    setGrid(prevGrid => {
      const rotated = rotateGrid(prevGrid);
      // Update dimensions to match rotated grid
      setGridWidth(rotated[0].length);
      setGridHeight(rotated.length);
      setWidthInput(String(rotated[0].length));
      setHeightInput(String(rotated.length));
      return rotated;
    });
  };

  const handleFlip = () => {
    setGrid(prevGrid => flipGrid(prevGrid));
  };

  const handleClear = () => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
  };

  const handlePolyformTypeChange = (type: PolyformType) => {
    setPolyformType(type);
    // Clear the grid when changing types
    setGrid(createEmptyGrid(gridWidth, gridHeight));
  };

  return (
    <div className="polyforms-page" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <h1>Polyforms Explorer</h1>
      <p className="description">
        Build polyominoes, polyhexes, or polyiamonds by clicking and dragging on the grid.
        Use the rotate and flip buttons to transform your polyform.
      </p>

      <div className="controls-section">
        <div className="control-group">
          <label htmlFor="polyform-type">Polyform Type:</label>
          <select
            id="polyform-type"
            value={polyformType}
            onChange={(e) => handlePolyformTypeChange(e.target.value as PolyformType)}
          >
            <option value="polyomino">Polyomino (squares)</option>
            <option value="polyhex">Polyhex (hexagons)</option>
            <option value="polyiamond">Polyiamond (triangles)</option>
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="grid-width">
            Width:
            <input
              id="grid-width"
              type="text"
              value={widthInput}
              onChange={(e) => setWidthInput(e.target.value)}
              onBlur={handleWidthBlur}
              className={widthError ? 'input-error' : ''}
              style={{ width: '60px', marginLeft: '8px' }}
            />
          </label>
          {widthError && <span className="error-message">Invalid width (1-50)</span>}
        </div>

        <div className="control-group">
          <label htmlFor="grid-height">
            Height:
            <input
              id="grid-height"
              type="text"
              value={heightInput}
              onChange={(e) => setHeightInput(e.target.value)}
              onBlur={handleHeightBlur}
              className={heightError ? 'input-error' : ''}
              style={{ width: '60px', marginLeft: '8px' }}
            />
          </label>
          {heightError && <span className="error-message">Invalid height (1-50)</span>}
        </div>
      </div>

      <div className="action-buttons">
        <button onClick={handleRotate} className="action-button">
          🔄 Rotate 90°
        </button>
        <button onClick={handleFlip} className="action-button">
          ↔️ Flip Horizontal
        </button>
        <button onClick={handleClear} className="action-button clear-button">
          🗑️ Clear
        </button>
      </div>

      <div className="grid-container" style={{ marginTop: '20px' }}>
        {polyformType === 'polyomino' && (
          <div className="square-grid" style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridWidth}, 40px)`,
            gap: '1px',
            backgroundColor: '#ccc',
            padding: '1px',
            width: 'fit-content',
          }}>
            {grid.map((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={`grid-cell ${cell.filled ? 'filled' : ''}`}
                  onMouseDown={() => handleCellMouseDown(rowIndex, colIndex)}
                  onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                  style={{
                    width: '40px',
                    height: '40px',
                    backgroundColor: cell.filled ? '#3498db' : '#fff',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                />
              ))
            )}
          </div>
        )}

        {polyformType === 'polyhex' && (
          <div className="hex-grid-container">
            <svg
              width={gridWidth * 43 + 22}
              height={gridHeight * 37.5 + 22.5}
              style={{ border: '1px solid #ccc', display: 'block' }}
            >
              {grid.map((row, rowIndex) =>
                row.map((cell, colIndex) => {
                  const isOddRow = rowIndex % 2 === 1;
                  const cx = 25 + colIndex * 43 + (isOddRow ? 21.5 : 0);
                  const cy = 25 + rowIndex * 37.5;
                  const hexSize = 20;

                  const points: [number, number][] = [];
                  for (let i = 0; i < 6; i++) {
                    const angleDeg = 60 * i - 30;
                    const angleRad = (Math.PI / 180) * angleDeg;
                    points.push([
                      cx + hexSize * Math.cos(angleRad),
                      cy + hexSize * Math.sin(angleRad)
                    ]);
                  }
                  const pathData = points.map((p, i) =>
                    `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`
                  ).join(' ') + ' Z';

                  return (
                    <path
                      key={`${rowIndex}-${colIndex}`}
                      d={pathData}
                      fill={cell.filled ? '#3498db' : '#fff'}
                      stroke="#666"
                      strokeWidth="1"
                      style={{ cursor: 'pointer' }}
                      onMouseDown={() => handleCellMouseDown(rowIndex, colIndex)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                    />
                  );
                })
              )}
            </svg>
          </div>
        )}

        {polyformType === 'polyiamond' && (
          <div className="iamond-grid-container">
            <svg
              width={gridWidth * 40 + 20}
              height={gridHeight * 35 + 20}
              style={{ border: '1px solid #ccc', display: 'block' }}
            >
              {grid.map((row, rowIndex) =>
                row.map((cell, colIndex) => {
                  const x = 10 + colIndex * 40;
                  const y = 10 + rowIndex * 35;
                  const size = 40;
                  const height = (size * Math.sqrt(3)) / 2;
                  
                  // Alternate up and down triangles
                  const isUpTriangle = (rowIndex + colIndex) % 2 === 0;
                  let pathData;
                  if (isUpTriangle) {
                    pathData = `M ${x + size / 2} ${y} L ${x + size} ${y + height} L ${x} ${y + height} Z`;
                  } else {
                    pathData = `M ${x} ${y} L ${x + size} ${y} L ${x + size / 2} ${y + height} Z`;
                  }

                  return (
                    <path
                      key={`${rowIndex}-${colIndex}`}
                      d={pathData}
                      fill={cell.filled ? '#3498db' : '#fff'}
                      stroke="#666"
                      strokeWidth="1"
                      style={{ cursor: 'pointer' }}
                      onMouseDown={() => handleCellMouseDown(rowIndex, colIndex)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                    />
                  );
                })
              )}
            </svg>
          </div>
        )}
      </div>

      <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
        <h3>Instructions</h3>
        <ul>
          <li><strong>Draw:</strong> Click and drag on the grid to build your polyform</li>
          <li><strong>Erase:</strong> Click and drag on filled cells to erase them</li>
          <li><strong>Rotate:</strong> Click the rotate button to turn your polyform 90° clockwise</li>
          <li><strong>Flip:</strong> Click the flip button to mirror your polyform horizontally</li>
          <li><strong>Resize:</strong> Change the width or height, then click outside the textbox to apply</li>
          <li><strong>Type:</strong> Switch between polyominoes (squares), polyhexes (hexagons), or polyiamonds (triangles)</li>
        </ul>
        <p style={{ fontStyle: 'italic', marginTop: '12px', color: '#666' }}>
          Note: The tiling solver feature will be added in a future update.
        </p>
      </div>
    </div>
  );
}
