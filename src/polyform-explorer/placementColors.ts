/**
 * Generate a set of distinct colors for the placements
 */
export function getPlacementColor(index: number, highlighted?: number | null): string {
  // Use HSL for evenly distributed colors
  const hue = (index * 137.508) % 360; // Golden angle approximation
  const isHighlighted = highlighted === index;
  if (highlighted !== null && highlighted !== undefined && !isHighlighted) {
    // Dim non-highlighted placements
    return `hsl(${hue}, 30%, 80%)`;
  }
  return `hsl(${hue}, 70%, 60%)`;
}
