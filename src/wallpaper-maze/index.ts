export { WallpaperMazeExplorer } from "./WallpaperMazeExplorer";
export { WallpaperMazeExplorerV2 } from "./components/WallpaperMazeExplorerV2";
export type { WallpaperGroupName, Direction, WallpaperGroup } from "./WallpaperGroups";
export { getWallpaperGroup, P1, P2, P4 } from "./WallpaperGroups";
export type { TiledGraph, TiledNode, TiledEdge, WallSegment } from "./TiledGraph";
export { buildTiledGraph, getRootColor, computeWallSegments, findEquivalentNodes } from "./TiledGraph";

// New manifold exports
export * from "./manifold";
export * from "./orbifold-lift";
