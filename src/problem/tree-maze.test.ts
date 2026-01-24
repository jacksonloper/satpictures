/**
 * Test for tree maze pathlength constraints
 */

import { describe, it, expect } from "vitest";
import { solveGridColoring } from "./grid-coloring";
import type { ColorGrid, PathlengthConstraint } from "./graph-types";

describe("Tree Maze Pathlength Constraints", () => {
  // Basic sanity test WITHOUT tree maze
  it("should solve 2x2 grid without tree maze", () => {
    const width = 2;
    const height = 2;
    
    const colors = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 0)
    );
    
    const grid: ColorGrid = { width, height, colors };
    
    const solution = solveGridColoring(grid, 6, {
      gridType: "square",
      pathlengthConstraints: [],
    });
    
    expect(solution).not.toBeNull();
  });

  // Minimal 2x1 test (1 bit)
  it("should solve 2x1 tree maze", () => {
    const width = 2;
    const height = 1;
    
    const colors = [[0, 0]];
    
    const grid: ColorGrid = { width, height, colors };
    
    const constraint: PathlengthConstraint = {
      id: "test_2x1",
      root: { row: 0, col: 0 },
      minDistances: {},
      treeMaze: true,
    };
    
    const solution = solveGridColoring(grid, 6, {
      gridType: "square",
      pathlengthConstraints: [constraint],
    });
    
    expect(solution).not.toBeNull();
  });
  
  // 2x2 test (2 bits)
  it("should solve 2x2 tree maze", () => {
    const width = 2;
    const height = 2;
    
    const colors = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 0)
    );
    
    const grid: ColorGrid = { width, height, colors };
    
    const constraint: PathlengthConstraint = {
      id: "test_2x2",
      root: { row: 0, col: 0 },
      minDistances: {},
      treeMaze: true,
    };
    
    const solution = solveGridColoring(grid, 6, {
      gridType: "square",
      pathlengthConstraints: [constraint],
    });
    
    expect(solution).not.toBeNull();
  });
  
  // 1x5 test (3 bits) - tests that larger grids work
  it("should solve 1x5 tree maze", () => {
    const width = 5;
    const height = 1;
    
    const colors = [[0, 0, 0, 0, 0]];
    
    const grid: ColorGrid = { width, height, colors };
    
    const constraint: PathlengthConstraint = {
      id: "test_1x5",
      root: { row: 0, col: 0 },
      minDistances: {},
      treeMaze: true,
    };
    
    const solution = solveGridColoring(grid, 6, {
      gridType: "square",
      pathlengthConstraints: [constraint],
    });
    
    expect(solution).not.toBeNull();
  });

  // 3x3 test (4 bits) - tests the "level ≠ 0" constraint
  it("should solve 3x3 tree maze", () => {
    const width = 3;
    const height = 3;
    
    const colors = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 0)
    );
    
    const grid: ColorGrid = { width, height, colors };
    
    const constraint: PathlengthConstraint = {
      id: "test_3x3",
      root: { row: 0, col: 0 },
      minDistances: {},
      treeMaze: true,
    };
    
    const solution = solveGridColoring(grid, 6, {
      gridType: "square",
      pathlengthConstraints: [constraint],
    });
    
    expect(solution).not.toBeNull();
  });
});
