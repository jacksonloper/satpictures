/**
 * Download an SVG element as a file
 */
export function downloadSvg(
  svgElement: SVGSVGElement,
  filename: string
): void {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export cells to a JSON string of coordinates and copy to clipboard
 */
export function exportCellsToJson(
  cells: boolean[][]
): string {
  const coords: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        coords.push({ row, col });
      }
    }
  }
  return JSON.stringify(coords, null, 2);
}

/**
 * Parse JSON coordinates string and return bounds and coordinates
 * @returns null if parsing fails, or an object with bounds and coordinates
 */
export function parseCoordsJson(
  jsonString: string
): { coords: Array<{ row: number; col: number }>; maxRow: number; maxCol: number } | null {
  try {
    const coords = JSON.parse(jsonString) as Array<{ row: number; col: number }>;
    if (!Array.isArray(coords)) {
      return null;
    }
    
    let maxRow = 0, maxCol = 0;
    for (const item of coords) {
      if (typeof item.row !== "number" || typeof item.col !== "number") {
        return null;
      }
      maxRow = Math.max(maxRow, item.row);
      maxCol = Math.max(maxCol, item.col);
    }
    
    return { coords, maxRow, maxCol };
  } catch {
    return null;
  }
}

/**
 * Download data as a JSON file
 */
export function downloadJson(
  data: unknown,
  filename: string
): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
