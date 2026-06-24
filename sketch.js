// sketch.js - 2D Sketch Data and Drawing Logic

// Canvas reference (initialized on DOM load)
let canvas;
let ctx;

// Sketch data model
const sketch = {
    points: [],       // Array of {x: number, y: number} in mm
    segments: [],     // Array of {start: index, end: index} referencing points
    polygons: []      // Array of {vertices: [index, index, ...]} for polygon cutouts
};

// Viewport constants
const MIN_SCALE = 0.01;   // Minimum zoom (very far out)
const MAX_SCALE = 200;    // Maximum zoom (very close in)
const ZOOM_FACTOR = 1.03; // Zoom multiplier per wheel tick
const SNAP_RADIUS = 5;   // pixels - radius for snapping to existing points

// Grid granularity (user adjustable)
// Grid granularity - central setting that can be easily adjusted
let gridGranularity = 0.2; // 0.1-2.0 range, 0.2 is the preferred default

// Viewport state
const viewport = {
    offsetX: 0,        // mm at center of canvas
    offsetY: -90,      // mm at center of canvas (10cm upwards)
    scale: 3,         // pixels per mm (50% more zoom than default of 2)
    panX: 0,          // panning offset in pixels
    panY: 0           // panning offset in pixels
};

// Panning state
let isPanning = false;
let panStart = { x: 0, y: 0 };
let shiftKeyPressed = false;

// Deletion state
let isDeleting = false;           // Toggle state for delete mode
let deletionCandidates = [];     // Array of segment indices to delete
let polygonDeletionCandidates = []; // Array of polygon indices to delete
let optionKeyPressed = false;    // Track Option/Alt key state

// Tool state
let currentTool = 'line';         // 'line' | 'polygon' | 'delete'

// Drawing state (for line tool)
let isDrawing = false;
let previewPoint = null;
let startPointIndex = null;
let newPointAdded = false;

// Polygon drawing state
let isDrawingPolygon = false;
let polygonVertices = [];         // Array of point indices for current polygon
let polygonStartIndex = null;    // Index of first vertex for current polygon
let polygonAddedPoints = [];     // Track indices of points added during current polygon drawing

// Move vertex tool state
let isMovingVertex = false;
let moveVertexCandidates = [];  // Array of point indices to move
let dragStartMM = null;          // Starting MM position of drag
let dragOriginalPositions = null; // Original positions of vertices being moved
let moveClosestEdge = null;     // Edge info for highlighting the closest edge (backwards compat)
let moveClosestEdges = [];      // Array of all edges at minimum distance for highlighting

// ============================================
// UNDO/REDO STATE
// ============================================
let undoStack = [];              // Stack of commands for undo
let redoStack = [];              // Stack of commands for redo
let undoLimit = 100;            // Maximum number of undo steps
let isUndoing = false;          // Flag to prevent recording commands during undo/redo

// ============================================
// COORDINATE TRANSFORMATIONS
// ============================================

function pixelToMM(pixelX, pixelY) {
    const mmX = (pixelX - canvas.width / 2 + viewport.panX) / viewport.scale - viewport.offsetX;
    const mmY = (pixelY - canvas.height / 2 + viewport.panY) / viewport.scale - viewport.offsetY;
    return { x: mmX, y: mmY };
}

function mmToPixel(mmX, mmY) {
    const pixelX = (mmX + viewport.offsetX) * viewport.scale + canvas.width / 2 - viewport.panX;
    const pixelY = (mmY + viewport.offsetY) * viewport.scale + canvas.height / 2 - viewport.panY;
    return { x: pixelX, y: pixelY };
}

// ============================================
// ADAPTIVE GRID HELPERS
// ============================================

/**
 * Calculate the base grid spacing based on current zoom level and granularity.
 * Returns a "nice" round number that adapts to the zoom level.
 */
function getAdaptiveGridSpacing() {
    const effectiveScale = viewport.scale * gridGranularity;
    
    // Discrete steps for nice round numbers
    // effectiveScale = pixels per mm * granularity
    // Higher effectiveScale = more zoomed in = finer grid
    // Lower effectiveScale = more zoomed out = coarser grid
    // At default: scale=2, granularity=1, effectiveScale=2 -> we want 1mm grid
    if (effectiveScale >= 50) return 0.125;    // Very zoomed in: 0.1mm
    if (effectiveScale >= 25) return 0.25;    // Very zoomed in: 0.2mm
    if (effectiveScale >= 10) return 0.5;    // Zoomed in: 0.5mm
    if (effectiveScale >= 2) return 1;      // Default and normal zoom: 1mm (at scale >= 2)
    if (effectiveScale >= 1) return 2;      // Slightly zoomed out: 2mm
    if (effectiveScale >= 0.5) return 5;   // Zoomed out: 5mm
    if (effectiveScale >= 0.25) return 10;  // More zoomed out: 10mm
    if (effectiveScale >= 0.1) return 16;   // Far zoomed out: 20mm
    if (effectiveScale >= 0.05) return 32;  // Very far: 50mm
    return 100; // Extremely far: 100mm
}

/**
 * Get current grid information for display
 */
function getCurrentGridInfo() {
    const minorSpacing = getAdaptiveGridSpacing();
    const majorSpacing = minorSpacing * 10;
    return { minorSpacing, majorSpacing, granularity: gridGranularity };
}

/**
 * Reset viewport to initial state
 */
function resetViewport() {
    viewport.offsetX = 0;
    viewport.offsetY = -90; // 10cm upwards
    viewport.scale = 3; // 50% more zoom (was 2)
    viewport.panX = 0;
    viewport.panY = 0;
    drawCanvas();
    updateGridDisplay();
}

/**
 * Update the grid size display in the UI
 */
function updateGridDisplay() {
    const gridInfo = getCurrentGridInfo();
    const gridSizeEl = document.getElementById('gridSize');
    if (gridSizeEl) {
        gridSizeEl.textContent = `Grid: ${gridInfo.minorSpacing.toFixed(1)}mm/${gridInfo.majorSpacing.toFixed(1)}mm`;
    }
}

// ============================================
// SVG OVERLAY
// ============================================

// SVG dimensions: viewBox="0 0 597.4 597.4" corresponds to 380mm x 380mm in real life
const SVG_VIEWBOX_WIDTH = 597.4;
const SVG_REAL_WIDTH_MM = 380; // 38cm
const SVG_SCALE_FACTOR = SVG_REAL_WIDTH_MM / SVG_VIEWBOX_WIDTH; // mm per SVG viewBox unit

/**
 * Update the SVG overlay position and scale to match the viewport
 */
function updateSVGOverlay() {
    const svgOverlay = document.getElementById('emberAreaOverlay');
    if (!svgOverlay) return;
    
    // The SVG represents 380mm x 380mm in real life, centered at the world origin (0, 0) in MM
    // So the SVG spans from (-190, -190) to (+190, +190) in MM coordinates
    
    // Convert the SVG corners from MM to pixels
    const tlPixel = mmToPixel(-190, -190);
    const brPixel = mmToPixel(190, 190);
    
    // Position and size the SVG element
    svgOverlay.style.left = `${tlPixel.x}px`;
    svgOverlay.style.top = `${tlPixel.y}px`;
    svgOverlay.style.width = `${brPixel.x - tlPixel.x}px`;
    svgOverlay.style.height = `${brPixel.y - tlPixel.y}px`;
}

// ============================================
// DELETION HELPERS
// ============================================

/**
 * Get the grid cell coordinates that a point belongs to
 * Returns { cellX, cellY } in mm, aligned to grid spacing
 * Uses floor to get cell containing point
 */
function getGridCell(mmX, mmY) {
    const gridSpacing = getAdaptiveGridSpacing();
    return {
        x: Math.floor(mmX / gridSpacing) * gridSpacing,
        y: Math.floor(mmY / gridSpacing) * gridSpacing
    };
}

/**
 * Check if segment (p1-p2) intersects the grid cell at (cellX, cellY) with given spacing.
 * A segment intersects if:
 *   - Either endpoint is inside the cell, OR
 *   - The segment crosses through the cell (including at edges), OR
 *   - The segment lies exactly on a cell edge
 *
 * Cell is defined as [cellX, cellRight) x [cellY, cellBottom) (half-open)
 * But edges are included: segments ON edges count as intersecting.
 */
function segmentIntersectsGridCell(p1, p2, cellX, cellY, gridSpacing) {
    const cellRight = cellX + gridSpacing;
    const cellBottom = cellY + gridSpacing;
    
    // Check if either endpoint is strictly inside the cell
    const p1InCell = p1.x >= cellX && p1.x < cellRight && p1.y >= cellY && p1.y < cellBottom;
    const p2InCell = p2.x >= cellX && p2.x < cellRight && p2.y >= cellY && p2.y < cellBottom;
    
    if (p1InCell || p2InCell) return true;
    
    // Check if segment lies exactly ON a cell edge
    // Vertical segment on left edge (x = cellX)
    if (p1.x === cellX && p2.x === cellX) {
        const segYMin = Math.min(p1.y, p2.y);
        const segYMax = Math.max(p1.y, p2.y);
        return segYMax >= cellY && segYMin <= cellBottom;
    }
    // Vertical segment on right edge (x = cellRight)
    if (p1.x === cellRight && p2.x === cellRight) {
        const segYMin = Math.min(p1.y, p2.y);
        const segYMax = Math.max(p1.y, p2.y);
        return segYMax >= cellY && segYMin <= cellBottom;
    }
    // Horizontal segment on top edge (y = cellY)
    if (p1.y === cellY && p2.y === cellY) {
        const segXMin = Math.min(p1.x, p2.x);
        const segXMax = Math.max(p1.x, p2.x);
        return segXMax >= cellX && segXMin <= cellRight;
    }
    // Horizontal segment on bottom edge (y = cellBottom)
    if (p1.y === cellBottom && p2.y === cellBottom) {
        const segXMin = Math.min(p1.x, p2.x);
        const segXMax = Math.max(p1.x, p2.x);
        return segXMax >= cellX && segXMin <= cellRight;
    }
    
    // For diagonal segments, check if they cross any of the 4 cell edges
    // Check left edge (x = cellX)
    if (p1.x !== p2.x) {
        const t = (cellX - p1.x) / (p2.x - p1.x);
        if (t >= 0 && t <= 1) {
            const y = p1.y + t * (p2.y - p1.y);
            if (y >= cellY && y <= cellBottom) return true;
        }
    }
    
    // Check right edge (x = cellRight)
    if (p1.x !== p2.x) {
        const t = (cellRight - p1.x) / (p2.x - p1.x);
        if (t >= 0 && t <= 1) {
            const y = p1.y + t * (p2.y - p1.y);
            if (y >= cellY && y <= cellBottom) return true;
        }
    }
    
    // Check top edge (y = cellY)
    if (p1.y !== p2.y) {
        const t = (cellY - p1.y) / (p2.y - p1.y);
        if (t >= 0 && t <= 1) {
            const x = p1.x + t * (p2.x - p1.x);
            if (x >= cellX && x <= cellRight) return true;
        }
    }
    
    // Check bottom edge (y = cellBottom)
    if (p1.y !== p2.y) {
        const t = (cellBottom - p1.y) / (p2.y - p1.y);
        if (t >= 0 && t <= 1) {
            const x = p1.x + t * (p2.x - p1.x);
            if (x >= cellX && x <= cellRight) return true;
        }
    }
    
    return false;
}

/**
 * Calculate distance from point to line segment
 * @param {number} px - Point x coordinate
 * @param {number} py - Point y coordinate
 * @param {Object} p1 - Segment start point {x, y}
 * @param {Object} p2 - Segment end point {x, y}
 * @returns {number} - Distance from point to segment
 */
function distanceToSegment(px, py, p1, p2) {
    // Vector from p1 to p2
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLenSq = dx * dx + dy * dy;
    
    if (segLenSq === 0) return Math.hypot(px - p1.x, py - p1.y);
    
    // Projection of point onto the line
    let t = ((px - p1.x) * dx + (py - p1.y) * dy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    
    // Closest point on segment
    const closestX = p1.x + t * dx;
    const closestY = p1.y + t * dy;
    
    return Math.hypot(px - closestX, py - closestY);
}

/**
 * Find all segments that are within a threshold distance from the given MM position
 * Returns array of segment indices
 */
function findDeletionCandidates(mmX, mmY) {
    const threshold = getAdaptiveGridSpacing() * 0.5; // Half a grid cell
    const candidates = [];
    
    sketch.segments.forEach((seg, idx) => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const dist = distanceToSegment(mmX, mmY, p1, p2);
        
        if (dist < threshold) {
            candidates.push(idx);
        }
    });
    
    return candidates;
}

/**
 * Delete segments by index and remove orphaned points
 * Rebuilds points array and remaps segment indices
 */
function deleteSegments(segmentIndices) {
    const indicesToDelete = new Set(segmentIndices);
    
    // Remove segments
    sketch.segments = sketch.segments.filter((_, idx) => !indicesToDelete.has(idx));
    
    // Find points that are still referenced by remaining segments OR polygons
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
    });
    sketch.polygons.forEach(poly => {
        poly.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
    });
    
    // Build new points array and create mapping from old index to new index
    const pointMap = new Map();
    const newPoints = [];
    let newIndex = 0;
    
    sketch.points.forEach((p, oldIndex) => {
        if (usedPointIndices.has(oldIndex)) {
            pointMap.set(oldIndex, newIndex);
            newPoints.push(p);
            newIndex++;
        }
    });
    
    sketch.points = newPoints;
    
    // Remap segment indices to new point indices
    sketch.segments.forEach(seg => {
        seg.start = pointMap.get(seg.start);
        seg.end = pointMap.get(seg.end);
    });
    
    // Remap polygon vertex indices to new point indices
    sketch.polygons.forEach(poly => {
        poly.vertices = poly.vertices.map(vIdx => pointMap.get(vIdx));
    });
    
    updateStatus();
}

/**
 * Remove zero-length segments (where start and end are the same point or same coordinates)
 */
function cleanupZeroLengthSegments() {
    const zeroLengthIndices = [];
    
    sketch.segments.forEach((seg, idx) => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        
        if (seg.start === seg.end || dist < 0.01) {
            zeroLengthIndices.push(idx);
        }
    });
    
    if (zeroLengthIndices.length > 0) {
        deleteSegments(zeroLengthIndices);
    }
}

/**
 * Remove orphaned points that were added during polygon drawing
 * Call this when polygon is discarded (Escape or mouseleave)
 */
function removePolygonOrphanedPoints() {
    if (polygonAddedPoints.length === 0) return;
    
    // Create a set of indices to delete for use in the deleteSegments pattern
    const indicesToDelete = new Set(polygonAddedPoints);
    
    // Find all point indices that are still referenced
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
    });
    sketch.polygons.forEach(poly => {
        poly.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
    });
    
    // Only keep points that are still referenced
    const usedPoints = [];
    const pointMap = new Map();
    let newIndex = 0;
    
    sketch.points.forEach((p, oldIndex) => {
        if (usedPointIndices.has(oldIndex) || !indicesToDelete.has(oldIndex)) {
            pointMap.set(oldIndex, newIndex);
            usedPoints.push(p);
            newIndex++;
        }
    });
    
    sketch.points = usedPoints;
    
    // Remap segment indices
    sketch.segments.forEach(seg => {
        seg.start = pointMap.get(seg.start);
        seg.end = pointMap.get(seg.end);
    });
    
    // Remap polygon vertex indices
    sketch.polygons.forEach(poly => {
        poly.vertices = poly.vertices.map(vIdx => pointMap.get(vIdx));
    });
    
    // Clear the tracking array
    polygonAddedPoints = [];
}

// ============================================
// POLYGON DELETION HELPERS
// ============================================

/**
 * Check if a point is inside a polygon using ray-casting algorithm
 * Includes a small buffer around edges for easier selection
 * @param {Object} point - {x, y} in mm
 * @param {Array} polyVertices - Array of point indices for the polygon
 * @returns {boolean} - True if point is inside polygon or within buffer of an edge
 */
function pointInPolygon(point, polyVertices) {
    const x = point.x;
    const y = point.y;
    let inside = false;
    
    // First, check if point is close to any edge (for easier selection)
    const buffer = getAdaptiveGridSpacing() * 0.5;
    for (let i = 0, j = polyVertices.length - 1; i < polyVertices.length; j = i++) {
        const p1 = sketch.points[polyVertices[i]];
        const p2 = sketch.points[polyVertices[j]];
        const dist = distanceToSegment(x, y, p1, p2);
        if (dist < buffer) {
            return true; // Point is close enough to an edge
        }
    }
    
    // Standard ray-casting algorithm
    for (let i = 0, j = polyVertices.length - 1; i < polyVertices.length; j = i++) {
        const xi = sketch.points[polyVertices[i]].x;
        const yi = sketch.points[polyVertices[i]].y;
        const xj = sketch.points[polyVertices[j]].x;
        const yj = sketch.points[polyVertices[j]].y;
        
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    
    return inside;
}

/**
 * Check for overlapping vertices in a polygon and remove duplicates
 * @param {Array} vertexIndices - Array of point indices for the polygon
 * @returns {Array} - New array with duplicates removed
 */
function removeOverlappingPolygonVertices(vertexIndices) {
    const threshold = getAdaptiveGridSpacing() * 0.1; // Small threshold for overlap detection
    const uniqueVertices = [];
    
    for (const idx of vertexIndices) {
        const point = sketch.points[idx];
        let isDuplicate = false;
        
        // Check against all already added unique vertices
        for (const uniqueIdx of uniqueVertices) {
            const uniquePoint = sketch.points[uniqueIdx];
            const dx = point.x - uniquePoint.x;
            const dy = point.y - uniquePoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < threshold) {
                isDuplicate = true;
                break;
            }
        }
        
        if (!isDuplicate) {
            uniqueVertices.push(idx);
        }
    }
    
    return uniqueVertices;
}

/**
 * Find polygon deletion candidates at a given position
 * @param {number} mmX - X coordinate in mm
 * @param {number} mmY - Y coordinate in mm
 * @returns {Array} - Array of polygon indices that contain the point
 */
function findPolygonDeletionCandidates(mmX, mmY) {
    const candidates = [];
    const point = { x: mmX, y: mmY };
    
    sketch.polygons.forEach((poly, idx) => {
        if (poly.vertices.length >= 3 && pointInPolygon(point, poly.vertices)) {
            candidates.push(idx);
        }
    });
    
    return candidates;
}

/**
 * Delete polygons by index and remove orphaned points
 */
function deletePolygons(polygonIndices) {
    const indicesToDelete = new Set(polygonIndices);
    
    // Remove polygons
    sketch.polygons = sketch.polygons.filter((_, idx) => !indicesToDelete.has(idx));
    
    // Find all point indices used by remaining segments and polygons
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
    });
    sketch.polygons.forEach(poly => {
        poly.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
    });
    
    // Build new points array and create mapping from old index to new index
    const pointMap = new Map();
    const newPoints = [];
    let newIndex = 0;
    
    sketch.points.forEach((p, oldIndex) => {
        if (usedPointIndices.has(oldIndex)) {
            pointMap.set(oldIndex, newIndex);
            newPoints.push(p);
            newIndex++;
        }
    });
    
    sketch.points = newPoints;
    
    // Remap segment indices to new point indices
    sketch.segments.forEach(seg => {
        seg.start = pointMap.get(seg.start);
        seg.end = pointMap.get(seg.end);
    });
    
    // Remap polygon vertex indices to new point indices
    sketch.polygons.forEach(poly => {
        poly.vertices = poly.vertices.map(vIdx => pointMap.get(vIdx));
    });
    
    polygonDeletionCandidates = [];
    updateStatus();
}

// ============================================
// MOVE VERTEX HELPERS
// ============================================

/**
 * Find vertices that should be highlighted/moved based on cursor position.
 * Selection algorithm:
 * 1. Find all vertices closer to cursor than currently visible grid size
 * 2. If these vertices are in multiple locations, select only those at the location closest to cursor
 * 3. From these vertices, select only those connected to the edge which is closest to cursor
 * 
 * @param {number} mmX - Cursor X position in mm
 * @param {number} mmY - Cursor Y position in mm
 * @returns {Array} - Array of point indices to highlight/move
 */
function findMoveVertexCandidates(mmX, mmY) {
    const gridSpacing = getAdaptiveGridSpacing();
    
    // Step 1: Find all vertices within gridSpacing distance of cursor
    const closeVertices = [];
    sketch.points.forEach((p, idx) => {
        const dx = p.x - mmX;
        const dy = p.y - mmY;
        const dist = Math.hypot(dx, dy);
        if (dist < gridSpacing) {
            closeVertices.push(idx);
        }
    });
    
    if (closeVertices.length === 0) {
        moveClosestEdge = null;
        moveClosestEdges = [];
        return [];
    }
    
    // Step 2: Group close vertices by their location (x,y coordinates)
    // Use a precision threshold for grouping to handle floating point coordinates
    const locationGroups = []; // Array of {pointIndices: [], avgX, avgY}
    const GROUP_PRECISION = 0.001; // 0.001mm precision for grouping
    
    closeVertices.forEach(idx => {
        const p = sketch.points[idx];
        
        // Find existing group that this point matches
        let foundGroup = null;
        for (const group of locationGroups) {
            const dx = p.x - group.avgX;
            const dy = p.y - group.avgY;
            if (Math.abs(dx) < GROUP_PRECISION && Math.abs(dy) < GROUP_PRECISION) {
                foundGroup = group;
                break;
            }
        }
        
        if (foundGroup) {
            foundGroup.pointIndices.push(idx);
            // Update average (not strictly necessary but keeps it accurate)
            const total = foundGroup.pointIndices.length;
            foundGroup.avgX = foundGroup.avgX * (total - 1) / total + p.x / total;
            foundGroup.avgY = foundGroup.avgY * (total - 1) / total + p.y / total;
        } else {
            locationGroups.push({
                pointIndices: [idx],
                avgX: p.x,
                avgY: p.y
            });
        }
    });
    
    // Find the location group closest to cursor
    let closestGroup = null;
    let closestGroupDist = Infinity;
    
    for (const group of locationGroups) {
        const dx = group.avgX - mmX;
        const dy = group.avgY - mmY;
        const dist = Math.hypot(dx, dy);
        if (dist < closestGroupDist) {
            closestGroupDist = dist;
            closestGroup = group;
        }
    }
    
    if (!closestGroup || closestGroup.pointIndices.length === 0) {
        moveClosestEdge = null;
        moveClosestEdges = [];
        return [];
    }
    
    // Step 3: From vertices in closest group, select only those whose connected edge is closest to cursor
    // For each vertex at the closest location, find its closest connected edge
    // Then select only vertices whose closest edge is the overall closest
    // Also collect ALL edges at the minimum distance for highlighting
    
    // Build a map of vertex index -> array of edges it belongs to
    const vertexEdges = new Map();
    closestGroup.pointIndices.forEach(vIdx => {
        vertexEdges.set(vIdx, []);
    });
    
    // Add regular segments
    sketch.segments.forEach((seg, segIdx) => {
        if (closestGroup.pointIndices.includes(seg.start)) {
            vertexEdges.get(seg.start).push({ 
                segIdx,
                start: seg.start,
                end: seg.end,
                isPolygon: false
            });
        }
        if (closestGroup.pointIndices.includes(seg.end)) {
            vertexEdges.get(seg.end).push({ 
                segIdx,
                start: seg.start,
                end: seg.end,
                isPolygon: false
            });
        }
    });
    
    // Add polygon edges
    sketch.polygons.forEach((poly, polyIdx) => {
        if (poly.vertices.length < 3) return;
        
        for (let i = 0; i < poly.vertices.length; i++) {
            const vIdx = poly.vertices[i];
            if (closestGroup.pointIndices.includes(vIdx)) {
                const prevIdx = poly.vertices[(i - 1 + poly.vertices.length) % poly.vertices.length];
                const nextIdx = poly.vertices[(i + 1) % poly.vertices.length];
                
                // Vertex is part of two polygon edges
                vertexEdges.get(vIdx).push({ 
                    segIdx: -polyIdx - 1,
                    start: prevIdx,
                    end: vIdx,
                    isPolygon: true
                });
                vertexEdges.get(vIdx).push({ 
                    segIdx: -polyIdx - 1,
                    start: vIdx,
                    end: nextIdx,
                    isPolygon: true
                });
            }
        }
    });
    
    // For each vertex, find its closest edge distance
    const vertexClosestEdgeDist = new Map();
    let globalClosestEdgeDist = Infinity;
    
    for (const [vIdx, edges] of vertexEdges) {
        if (edges.length === 0) {
            // Vertex not connected to any edge - use large distance
            vertexClosestEdgeDist.set(vIdx, Infinity);
            continue;
        }
        
        // Find the closest edge for this vertex
        let closestDist = Infinity;
        for (const edgeInfo of edges) {
            const p1 = sketch.points[edgeInfo.start];
            const p2 = sketch.points[edgeInfo.end];
            const dist = distanceToSegment(mmX, mmY, p1, p2);
            if (dist < closestDist) {
                closestDist = dist;
            }
        }
        
        vertexClosestEdgeDist.set(vIdx, closestDist);
        
        // Track global minimum
        if (closestDist < globalClosestEdgeDist) {
            globalClosestEdgeDist = closestDist;
        }
    }
    
    if (globalClosestEdgeDist === Infinity) {
        // No edges found - return all vertices in closest group
        moveClosestEdge = null;
        return closestGroup.pointIndices;
    }
    
    // Collect ALL edges at the minimum distance for highlighting
    // and find which vertices to select
    const closestEdges = [];
    const selectedVertices = [];
    
    for (const vIdx of closestGroup.pointIndices) {
        const dist = vertexClosestEdgeDist.get(vIdx);
        if (dist === globalClosestEdgeDist) {
            selectedVertices.push(vIdx);
            // Add all edges for this vertex that are at the minimum distance
            for (const edgeInfo of vertexEdges.get(vIdx)) {
                const p1 = sketch.points[edgeInfo.start];
                const p2 = sketch.points[edgeInfo.end];
                const edgeDist = distanceToSegment(mmX, mmY, p1, p2);
                if (Math.abs(edgeDist - globalClosestEdgeDist) < 0.001) {
                    // Check if this edge is already in the list
                    const edgeKey = `${edgeInfo.start},${edgeInfo.end}`;
                    const key2 = `${edgeInfo.end},${edgeInfo.start}`; // Reverse direction
                    const alreadyAdded = closestEdges.some(e => 
                        `${e.start},${e.end}` === edgeKey || `${e.start},${e.end}` === key2
                    );
                    if (!alreadyAdded) {
                        closestEdges.push(edgeInfo);
                    }
                }
            }
        }
    }
    
    // Store all closest edges for highlighting (use first one or all)
    moveClosestEdge = closestEdges.length > 0 ? closestEdges[0] : null;
    // Actually, let's store all of them in a new variable
    moveClosestEdges = closestEdges;
    
    return selectedVertices;
}

/**
 * Handle move vertex tool input
 * @param {string} type - 'down', 'move', or 'up'
 * @param {Object} mm - {x, y} cursor position in mm
 */
function handleVertexMoveInput(type, mm) {
    if (type === 'move') {
        if (isMovingVertex) {
            // We're currently dragging - move the vertices
            const snappedMM = snapToGrid(mm.x, mm.y);
            
            // Calculate offset from the SNAPPED drag start position
            // Both start and current positions are snapped to ensure vertices land on grid
            const dx = snappedMM.x - dragStartMM.x;
            const dy = snappedMM.y - dragStartMM.y;
            
            // Move all candidate vertices from their original positions by the offset
            moveVertexCandidates.forEach(idx => {
                sketch.points[idx] = {
                    x: dragOriginalPositions.get(idx).x + dx,
                    y: dragOriginalPositions.get(idx).y + dy
                };
            });
            
            // Check for overlapping vertices in all polygons containing moved vertices
            const movedVertexSet = new Set(moveVertexCandidates);
            for (let i = 0; i < sketch.polygons.length; i++) {
                const poly = sketch.polygons[i];
                let hasMovedVertex = false;
                
                // Check if this polygon has any moved vertices
                for (const vIdx of poly.vertices) {
                    if (movedVertexSet.has(vIdx)) {
                        hasMovedVertex = true;
                        break;
                    }
                }
                
                if (hasMovedVertex) {
                    // Clean up overlapping vertices in this polygon
                    sketch.polygons[i].vertices = removeOverlappingPolygonVertices(poly.vertices);
                }
            }
            
            drawCanvas();
        } else {
            // Not dragging, just update candidates for highlighting
            moveVertexCandidates = findMoveVertexCandidates(mm.x, mm.y);
            drawCanvas();
        }
    } else if (type === 'down') {
        // Start dragging if there are candidates
        if (moveVertexCandidates.length > 0) {
            // Save state before the drag for undo
            const beforeState = saveStateForUndo();
            
            isMovingVertex = true;
            // Snap the drag start position to grid so vertices land on grid
            const snappedStart = snapToGrid(mm.x, mm.y);
            dragStartMM = { x: snappedStart.x, y: snappedStart.y };
            
            // Store original positions - these never change during the drag
            dragOriginalPositions = new Map();
            moveVertexCandidates.forEach(idx => {
                dragOriginalPositions.set(idx, {
                    x: sketch.points[idx].x,
                    y: sketch.points[idx].y
                });
            });
            
            // Store before state for undo
            window.moveVertexBeforeState = beforeState;
        }
    } else if (type === 'up') {
        if (isMovingVertex) {
            // Use the stored before state from when the drag started
            if (window.moveVertexBeforeState) {
                recordSimpleAction(window.moveVertexBeforeState);
                window.moveVertexBeforeState = null;
                updateStatus();
            }
            
            isMovingVertex = false;
            dragStartMM = null;
            dragOriginalPositions = null;
            // Keep moveVertexCandidates for continuous highlighting
            drawCanvas();
        }
    }
}

// ============================================
// SNAPPING HELPERS
// ============================================

function snapToGrid(mmX, mmY) {
    const gridSpacing = getAdaptiveGridSpacing();
    return { 
        x: Math.round(mmX / gridSpacing) * gridSpacing,
        y: Math.round(mmY / gridSpacing) * gridSpacing
    };
}

function findNearestPoint(mmX, mmY, maxDistanceMM) {
    let nearestIndex = -1;
    let nearestDist = Infinity;
    
    sketch.points.forEach((p, i) => {
        const dx = p.x - mmX;
        const dy = p.y - mmY;
        const dist = Math.hypot(dx, dy);
        if (dist < maxDistanceMM && dist < nearestDist) {
            nearestDist = dist;
            nearestIndex = i;
        }
    });
    
    return nearestIndex !== -1 ? nearestIndex : null;
}

function snapToExistingPoint(mmX, mmY) {
    const snapRadiusMM = SNAP_RADIUS / viewport.scale;
    const nearestIndex = findNearestPoint(mmX, mmY, snapRadiusMM);
    if (nearestIndex !== null) {
        return { x: sketch.points[nearestIndex].x, y: sketch.points[nearestIndex].y };
    }
    return snapToGrid(mmX, mmY);
}

// ============================================
// SKETCH OPERATIONS
// ============================================

function clearSketch() {
    // Save state before clearing for undo
    const beforeState = saveStateForUndo();
    
    sketch.points = [];
    sketch.segments = [];
    sketch.polygons = [];
    isDrawing = false;
    previewPoint = null;
    startPointIndex = null;
    newPointAdded = false;
    isDrawingPolygon = false;
    polygonVertices = [];
    polygonStartIndex = null;
    polygonAddedPoints = [];
    polygonDeletionCandidates = [];
    deletionCandidates = [];
    window.polygonBeforeState = null; // Clean up saved state
    
    // Record the action for undo
    if (beforeState) {
        recordSimpleAction(beforeState);
        updateStatus();
    }
    
    // Mark as dirty for save/load system
    if (typeof markSketchDirty === 'function') {
        markSketchDirty();
    }
}

function computeBoundingBox() {
    if (sketch.points.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    // Include all points (including those used by polygons)
    sketch.points.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });
    
    return { minX, maxX, minY, maxY };
}

function getSketchStats() {
    return {
        pointCount: sketch.points.length,
        segmentCount: sketch.segments.length,
        polygonCount: sketch.polygons.length
    };
}

// ============================================
// CANVAS DRAWING
// ============================================

function drawGrid() {
    const gridSpacing = getAdaptiveGridSpacing();
    const majorSpacing = gridSpacing * 10;
    
    // Calculate visible range in MM, accounting for panning
    // The viewport shows a region of the MM world from (minX, minY) to (maxX, maxY)
    const minX = pixelToMM(0, 0).x;
    const maxX = pixelToMM(canvas.width, 0).x;
    const minY = pixelToMM(0, 0).y;
    const maxY = pixelToMM(0, canvas.height).y;
    
    // Adapt line width to zoom level - thinner when zoomed out
    const lineWidthScale = Math.min(2, Math.max(0.5, 1 / Math.sqrt(viewport.scale)));
    
    // Minor grid lines
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1 * lineWidthScale;
    
    // Draw vertical grid lines
    for (let x = Math.floor(minX / gridSpacing) * gridSpacing; x <= maxX; x += gridSpacing) {
        const px = mmToPixel(x, 0).x;
        if (px >= 0 && px <= canvas.width) {
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvas.height);
            ctx.stroke();
        }
    }
    
    // Draw horizontal grid lines
    for (let y = Math.floor(minY / gridSpacing) * gridSpacing; y <= maxY; y += gridSpacing) {
        const py = mmToPixel(0, y).y;
        if (py >= 0 && py <= canvas.height) {
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(canvas.width, py);
            ctx.stroke();
        }
    }
    
    // Major grid lines (10x minor spacing)
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2 * lineWidthScale;
    
    // Draw major vertical grid lines
    for (let x = Math.floor(minX / majorSpacing) * majorSpacing; x <= maxX; x += majorSpacing) {
        const px = mmToPixel(x, 0).x;
        if (px >= 0 && px <= canvas.width) {
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvas.height);
            ctx.stroke();
        }
    }
    
    // Draw major horizontal grid lines
    for (let y = Math.floor(minY / majorSpacing) * majorSpacing; y <= maxY; y += majorSpacing) {
        const py = mmToPixel(0, y).y;
        if (py >= 0 && py <= canvas.height) {
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(canvas.width, py);
            ctx.stroke();
        }
    }
}

function drawSketch() {
    // Draw segments - deletion candidates in red, others in black
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    sketch.segments.forEach((seg, idx) => {
        const isCandidate = deletionCandidates.includes(idx);
        ctx.strokeStyle = isCandidate ? '#ff0000' : '#000';
        ctx.lineWidth = isCandidate ? 3 : 2;
        
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const pixel1 = mmToPixel(p1.x, p1.y);
        const pixel2 = mmToPixel(p2.x, p2.y);
        
        ctx.beginPath();
        ctx.moveTo(pixel1.x, pixel1.y);
        ctx.lineTo(pixel2.x, pixel2.y);
        ctx.stroke();
    });
    
    // Draw polygons - dark blue edges with semi-transparent fill
    sketch.polygons.forEach((poly, polyIdx) => {
        if (poly.vertices.length >= 3) {
            const isPolygonCandidate = polygonDeletionCandidates.includes(polyIdx);
            
            // Draw polygon fill (semi-transparent blue or red for deletion candidates)
            ctx.fillStyle = isPolygonCandidate ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 100, 255, 0.3)';
            ctx.beginPath();
            const firstPixel = mmToPixel(sketch.points[poly.vertices[0]].x, sketch.points[poly.vertices[0]].y);
            ctx.moveTo(firstPixel.x, firstPixel.y);
            for (let i = 1; i < poly.vertices.length; i++) {
                const pixel = mmToPixel(sketch.points[poly.vertices[i]].x, sketch.points[poly.vertices[i]].y);
                ctx.lineTo(pixel.x, pixel.y);
            }
            // Close the path back to first vertex
            ctx.lineTo(firstPixel.x, firstPixel.y);
            ctx.fill();
            
            // Draw polygon edges (dark blue or red for deletion candidates)
            ctx.strokeStyle = isPolygonCandidate ? '#ff0000' : '#004880';
            ctx.lineWidth = isPolygonCandidate ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(firstPixel.x, firstPixel.y);
            for (let i = 1; i < poly.vertices.length; i++) {
                const pixel = mmToPixel(sketch.points[poly.vertices[i]].x, sketch.points[poly.vertices[i]].y);
                ctx.lineTo(pixel.x, pixel.y);
            }
            // Close the path back to first vertex
            ctx.lineTo(firstPixel.x, firstPixel.y);
            ctx.stroke();
        }
    });
    
    // Draw closest edge(s) in bold for move tool
    if (currentTool === 'move' && moveClosestEdges.length > 0) {
        ctx.strokeStyle = '#ffa500';  // Orange to match vertex highlight
        ctx.lineWidth = 4;  // Bold line
        
        moveClosestEdges.forEach(edgeInfo => {
            const p1 = sketch.points[edgeInfo.start];
            const p2 = sketch.points[edgeInfo.end];
            const pixel1 = mmToPixel(p1.x, p1.y);
            const pixel2 = mmToPixel(p2.x, p2.y);
            
            ctx.beginPath();
            ctx.moveTo(pixel1.x, pixel1.y);
            ctx.lineTo(pixel2.x, pixel2.y);
            ctx.stroke();
        });
        
        // Reset line width for subsequent drawing
        ctx.lineWidth = 2;
    }
    
    // Draw points
    ctx.fillStyle = '#4a90e2';
    sketch.points.forEach(p => {
        const pixel = mmToPixel(p.x, p.y);
        ctx.beginPath();
        ctx.arc(pixel.x, pixel.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Draw move vertex candidates in orange
    if (currentTool === 'move' && moveVertexCandidates.length > 0) {
        ctx.fillStyle = '#ffa500';
        moveVertexCandidates.forEach(idx => {
            const p = sketch.points[idx];
            const pixel = mmToPixel(p.x, p.y);
            ctx.beginPath();
            ctx.arc(pixel.x, pixel.y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
    }
}

function drawPreview() {
    // Draw line tool preview
    if (currentTool === 'line' && isDrawing && startPointIndex !== null) {
        const startPt = sketch.points[startPointIndex];
        const startPixel = mmToPixel(startPt.x, startPt.y);
        
        if (previewPoint) {
            const previewPixel = mmToPixel(previewPoint.x, previewPoint.y);
            
            // Draw preview line
            ctx.strokeStyle = '#4a90e2';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(startPixel.x, startPixel.y);
            ctx.lineTo(previewPixel.x, previewPixel.y);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw preview point
            ctx.fillStyle = '#4a90e2';
            ctx.beginPath();
            ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Highlight the start point
            ctx.fillStyle = '#4a90e2';
            ctx.beginPath();
            ctx.arc(startPixel.x, startPixel.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Draw polygon tool preview
    if (currentTool === 'polygon' && isDrawingPolygon && polygonVertices.length > 0) {
        // Get the current mouse position for preview
        const previewPixel = previewPoint ? mmToPixel(previewPoint.x, previewPoint.y) : null;
        
        // Draw preview line from last vertex to cursor
        if (previewPixel) {
            const lastVertex = sketch.points[polygonVertices[polygonVertices.length - 1]];
            const lastPixel = mmToPixel(lastVertex.x, lastVertex.y);
            
            // Draw preview line (dark blue dashed)
            ctx.strokeStyle = '#004880';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(lastPixel.x, lastPixel.y);
            ctx.lineTo(previewPixel.x, previewPixel.y);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw preview point
            ctx.fillStyle = '#004880';
            ctx.beginPath();
            ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Highlight the first vertex to show where to click to close
        const firstVertex = sketch.points[polygonStartIndex];
        const firstPixel = mmToPixel(firstVertex.x, firstVertex.y);
        ctx.fillStyle = '#0080ff';
        ctx.beginPath();
        ctx.arc(firstPixel.x, firstPixel.y, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw current polygon vertices being placed (as a preview polygon with dashed lines)
        if (polygonVertices.length > 1) {
            ctx.strokeStyle = '#004880';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            const firstPx = mmToPixel(sketch.points[polygonVertices[0]].x, sketch.points[polygonVertices[0]].y);
            ctx.moveTo(firstPx.x, firstPx.y);
            for (let i = 1; i < polygonVertices.length; i++) {
                const px = mmToPixel(sketch.points[polygonVertices[i]].x, sketch.points[polygonVertices[i]].y);
                ctx.lineTo(px.x, px.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

function drawCanvas() {
    if (!canvas || !ctx) {
        console.warn('Canvas or context not initialized');
        return;
    }
    
    // Fill with white background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawGrid();
    drawSketch();
    drawPreview();
    
    // Update grid size display and SVG overlay after drawing
    updateGridDisplay();
    updateSVGOverlay();
}

// ============================================
// INPUT HANDLING
// ============================================

function handleCanvasInput(type, mouseX, mouseY) {
    const mm = pixelToMM(mouseX, mouseY);
    const snappedMM = snapToExistingPoint(mm.x, mm.y);
    
    // In deletion mode (toggle or Alt/Option key), handle differently
    if (currentTool === 'delete' || optionKeyPressed) {
        if (type === 'move') {
            // Update deletion candidates as cursor moves
            deletionCandidates = findDeletionCandidates(snappedMM.x, snappedMM.y);
            polygonDeletionCandidates = findPolygonDeletionCandidates(snappedMM.x, snappedMM.y);
            drawCanvas();
        } else if (type === 'up') {
            // Delete the candidates on click release
            if (polygonDeletionCandidates.length > 0) {
                // Save state before the action for undo
                const beforeState = saveStateForUndo();
                deletePolygons(polygonDeletionCandidates);
                
                // Record the action for undo
                recordSimpleAction(beforeState);
                
                polygonDeletionCandidates = [];
                deletionCandidates = [];
                drawCanvas();
                updateStatus();
            } else if (deletionCandidates.length > 0) {
                // Save state before the action for undo
                const beforeState = saveStateForUndo();
                deleteSegments(deletionCandidates);
                
                // Record the action for undo
                recordSimpleAction(beforeState);
                
                deletionCandidates = [];
                drawCanvas();
                updateStatus();
            }
        }
        return;  // Don't handle drawing in deletion mode
    }
    
    // Polygon drawing logic
    if (currentTool === 'polygon') {
        handlePolygonInput(type, snappedMM);
        return;
    }
    
    // Move vertex tool logic
    if (currentTool === 'move') {
        handleVertexMoveInput(type, mm);
        return; // Move tool handles everything, no fall through
    }
    
    // Line drawing logic
    if (type === 'down') {
        if (!isDrawing) {
            // Save state before adding the first point for undo
            const beforeState = saveStateForUndo();
            
            // ALWAYS create a new point, even when snapping to existing ones
            // This allows independent vertex movement in the move tool
            const newIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            startPointIndex = newIndex;
            isDrawing = true;
            previewPoint = null;
            newPointAdded = true;
            
            // Store beforeState for potential undo
            window.lineDrawBeforeState = beforeState;
            
            drawCanvas();
        }
    } else if (type === 'move') {
        if (isDrawing) {
            previewPoint = { x: snappedMM.x, y: snappedMM.y };
            drawCanvas();
        }
    } else if (type === 'up') {
        if (isDrawing) {
            isDrawing = false;
            
            let segmentCreated = false;
            
            if (previewPoint) {
                const startPt = sketch.points[startPointIndex];
                const dist = Math.hypot(
                    previewPoint.x - startPt.x,
                    previewPoint.y - startPt.y
                );
                
                if (dist > 0.01) {
                    // ALWAYS create a new end point, even when snapping
                    const endPointIndex = sketch.points.length;
                    sketch.points.push({ x: previewPoint.x, y: previewPoint.y });
                    
                    // Check if this would create a zero-length segment
                    const endPt = sketch.points[endPointIndex];
                    const endDist = Math.hypot(
                        endPt.x - startPt.x,
                        endPt.y - startPt.y
                    );
                    if (startPointIndex !== endPointIndex && endDist > 0.01) {
                        sketch.segments.push({
                            start: startPointIndex,
                            end: endPointIndex
                        });
                        segmentCreated = true;
                        
                        // Record the action for undo (using the state saved before first point was added)
                        if (window.lineDrawBeforeState) {
                            recordSimpleAction(window.lineDrawBeforeState);
                            window.lineDrawBeforeState = null;
                            updateStatus();
                        }
                    } else {
                        // Remove the end point that was added but not used
                        sketch.points.pop();
                    }
                }
            }
            
            // If a new point was added but no segment was created, remove the orphaned point
            if (newPointAdded && !segmentCreated) {
                sketch.points.pop();
                // Clear the stored beforeState since we didn't create a segment
                window.lineDrawBeforeState = null;
            }
            
            // Clean up any zero-length segments and orphaned points
            cleanupZeroLengthSegments();
            
            previewPoint = null;
            startPointIndex = null;
            newPointAdded = false;
            drawCanvas();
        }
    }
}

// ============================================
// POLYGON INPUT HANDLING
// ============================================

/**
 * Handle polygon drawing input
 * @param {string} type - 'down', 'move', or 'up'
 * @param {Object} snappedMM - {x, y} snapped to grid/existing points
 */
function handlePolygonInput(type, snappedMM) {
    if (type === 'down') {
        // Find nearest existing point (for snapping, but we'll create a new point)
        const nearestIndex = findNearestPoint(snappedMM.x, snappedMM.y, SNAP_RADIUS / viewport.scale);
        
        if (!isDrawingPolygon) {
            // Start a new polygon
            polygonAddedPoints = []; // Reset tracking for new polygon
            
            // Save state before adding any points for this polygon
            const polygonBeforeState = saveStateForUndo();
            
            // ALWAYS create a new point, even when snapping to existing ones
            // This allows independent vertex movement in the move tool
            polygonStartIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            polygonVertices = [polygonStartIndex];
            polygonAddedPoints.push(polygonStartIndex);
            isDrawingPolygon = true;
            previewPoint = null; // Reset preview point for new polygon
            
            // Store the before state in a window variable for later use
            window.polygonBeforeState = polygonBeforeState;
            
            drawCanvas();
        } else {
            // Continuing an existing polygon
            // Check if clicked on first vertex (to close polygon)
            // We need to check if the snapped position is close to the first vertex's position
            if (polygonVertices.length >= 3) {
                const firstVertex = sketch.points[polygonStartIndex];
                const distToFirst = Math.hypot(
                    snappedMM.x - firstVertex.x,
                    snappedMM.y - firstVertex.y
                );
                if (distToFirst < SNAP_RADIUS / viewport.scale) {
                    // Use the state saved when starting the polygon
                    const beforeState = window.polygonBeforeState;
                    
                    // Close the polygon - check for overlapping vertices first
                    const cleanedVertices = removeOverlappingPolygonVertices([...polygonVertices]);
                    sketch.polygons.push({
                        vertices: cleanedVertices
                    });
                    
                    // Record the action for undo
                    if (beforeState) {
                        recordSimpleAction(beforeState);
                        window.polygonBeforeState = null;
                    }
                    
                    // Reset polygon drawing state
                    isDrawingPolygon = false;
                    polygonVertices = [];
                    polygonStartIndex = null;
                    polygonAddedPoints = [];
                    previewPoint = null;
                    
                    drawCanvas();
                    updateStatus();
                    return;
                }
            }
            
            // ALWAYS create a new point for polygon vertices
            const newIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            
            // Check if this new point overlaps with any existing vertex in polygonVertices
            const threshold = getAdaptiveGridSpacing() * 0.1;
            let isDuplicate = false;
            const newPoint = sketch.points[newIndex];
            
            for (const existingIdx of polygonVertices) {
                const existingPoint = sketch.points[existingIdx];
                const dx = newPoint.x - existingPoint.x;
                const dy = newPoint.y - existingPoint.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < threshold) {
                    isDuplicate = true;
                    break;
                }
            }
            
            if (!isDuplicate) {
                polygonVertices.push(newIndex);
                polygonAddedPoints.push(newIndex);
            } else {
                // Remove the duplicate point we just added
                sketch.points.pop();
            }
            
            drawCanvas();
        }
    } else if (type === 'move') {
        if (isDrawingPolygon) {
            // Update preview point for cursor tracking
            previewPoint = snappedMM;
            drawCanvas();
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

function initSketchCanvas() {
    console.log('Initializing sketch canvas...');
    canvas = document.getElementById('sketchCanvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }
    ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('Could not get 2D context!');
        return;
    }
    console.log('Canvas initialized:', canvas.width, 'x', canvas.height);
    
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        drawCanvas();
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Mouse event listeners
    // Track shift key state for panning
    window.addEventListener('keydown', (e) => {
        if (e.shiftKey) {
            shiftKeyPressed = true;
        }
        // Track Option/Alt key for deletion mode
        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'Option') {
            optionKeyPressed = true;
            e.preventDefault();
        }
        
        // Undo/Redo keyboard shortcuts
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            if (e.key === 'z' || e.key === 'Z') {
                undo();
                e.preventDefault();
            } else if (e.key === 'y' || e.key === 'Y') {
                redo();
                e.preventDefault();
            }
        }
        
        // Polygon tool keyboard shortcuts
        if (currentTool === 'polygon') {
            if (e.code === 'Escape') {
                // Cancel polygon drawing
                if (isDrawingPolygon) {
                    isDrawingPolygon = false;
                    polygonVertices = [];
                    polygonStartIndex = null;
                    window.polygonBeforeState = null; // Clean up saved state
                    removePolygonOrphanedPoints();
                    drawCanvas();
                    updateStatus();
                }
                e.preventDefault();
            } else if (e.code === 'Enter' && isDrawingPolygon && polygonVertices.length >= 3) {
                // Use the state saved when starting the polygon
                const beforeState = window.polygonBeforeState;
                
                // Auto-close polygon - check for overlapping vertices first
                const cleanedVertices = removeOverlappingPolygonVertices([...polygonVertices]);
                sketch.polygons.push({
                    vertices: cleanedVertices
                });
                
                // Record the action for undo
                if (beforeState) {
                    recordSimpleAction(beforeState);
                    window.polygonBeforeState = null;
                }
                
                isDrawingPolygon = false;
                polygonVertices = [];
                polygonStartIndex = null;
                polygonAddedPoints = [];
                previewPoint = null;
                drawCanvas();
                updateStatus();
                e.preventDefault();
            }
        }
    });
    
    window.addEventListener('keyup', (e) => {
        if (!e.shiftKey) {
            shiftKeyPressed = false;
        }
        // Track Option/Alt key release
        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'Option') {
            optionKeyPressed = false;
            deletionCandidates = [];
            drawCanvas();
            e.preventDefault();
        }
    });
    
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Check if this is a pan gesture (middle mouse button or Shift + left click)
        if (e.button === 1 || (e.button === 0 && shiftKeyPressed)) {
            isPanning = true;
            panStart = { x: mouseX, y: mouseY };
            e.preventDefault();
            return;
        }
        
        handleCanvasInput('down', mouseX, mouseY);
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Handle panning
        if (isPanning) {
            const dx = mouseX - panStart.x;
            const dy = mouseY - panStart.y;
            viewport.panX -= dx;
            viewport.panY -= dy;
            panStart = { x: mouseX, y: mouseY };
            drawCanvas();
            return;
        }
        
        handleCanvasInput('move', mouseX, mouseY);
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
            e.preventDefault();
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        handleCanvasInput('up', e.clientX - rect.left, e.clientY - rect.top);
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (isDrawing) {
            isDrawing = false;
            previewPoint = null;
            startPointIndex = null;
            // Remove orphaned point if one was added but no segment was created
            if (newPointAdded) {
                sketch.points.pop();
                newPointAdded = false;
            }
            drawCanvas();
        }
        if (isDrawingPolygon) {
            // Cancel polygon drawing on mouse leave
            isDrawingPolygon = false;
            polygonVertices = [];
            polygonStartIndex = null;
            previewPoint = null;
            window.polygonBeforeState = null; // Clean up saved state
            removePolygonOrphanedPoints();
            drawCanvas();
        }
        if (isPanning) {
            isPanning = false;
        }
    });
    
    // Wheel event for zooming
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate zoom factor
        const zoomIn = e.deltaY < 0;
        const zoomFactor = zoomIn ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        
        // Get mouse position in MM before zoom
        const mouseMM = pixelToMM(mouseX, mouseY);
        
        // Apply zoom
        const oldScale = viewport.scale;
        viewport.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * zoomFactor));
        
        // Adjust offset to zoom toward mouse position
        // The adjustment is: offset += (mouseMMAfter - mouseMM) which is equivalent to
        // offset -= (mouseMM - mouseMMAfter)
        const mouseMMAfter = pixelToMM(mouseX, mouseY);
        viewport.offsetX += (mouseMMAfter.x - mouseMM.x);
        viewport.offsetY += (mouseMMAfter.y - mouseMM.y);
        
        drawCanvas();
        updateGridDisplay();
    }, { passive: false });
    
    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        handleCanvasInput('down', touch.clientX - rect.left, touch.clientY - rect.top);
    });
    
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        handleCanvasInput('move', touch.clientX - rect.left, touch.clientY - rect.top);
    });
    
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (e.changedTouches && e.changedTouches.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const touch = e.changedTouches[0];
            handleCanvasInput('up', touch.clientX - rect.left, touch.clientY - rect.top);
        }
    });
    
    // Clean up any existing zero-length segments on initialization
    cleanupZeroLengthSegments();
    
    drawCanvas();
}

// ============================================
// UNDO/REDO SYSTEM (STATE-BASED APPROACH)
// ============================================

/**
 * Save current sketch state for undo
 * Uses a state-based approach: each action saves the complete state before the action
 */
function saveStateForUndo() {
    if (isUndoing) return null;
    
    return {
        points: sketch.points.map(p => ({ x: p.x, y: p.y })),
        segments: sketch.segments.map(seg => ({ start: seg.start, end: seg.end })),
        polygons: sketch.polygons.map(poly => ({ vertices: poly.vertices.slice() }))
    };
}

/**
 * Restore sketch state from saved state
 */
function restoreState(state) {
    sketch.points = state.points.map(p => ({ x: p.x, y: p.y }));
    sketch.segments = state.segments.map(seg => ({ start: seg.start, end: seg.end }));
    sketch.polygons = state.polygons.map(poly => ({ vertices: poly.vertices.slice() }));
    
    // Clear move vertex candidates to prevent stale highlights
    moveVertexCandidates = [];
    moveClosestEdge = null;
    moveClosestEdges = [];
    
    // Clear deletion candidates to prevent stale highlights
    deletionCandidates = [];
    polygonDeletionCandidates = [];
}

/**
 * Record an action with before/after states
 */
function recordAction(beforeState, afterState) {
    if (isUndoing) return;
    
    // Push to undo stack
    undoStack.push({ beforeState, afterState });
    
    // Trim undo stack if it exceeds the limit
    if (undoStack.length > undoLimit) {
        undoStack.shift();
    }
    
    // Clear redo stack when a new action is recorded
    redoStack = [];
}

/**
 * Record a simple action (only stores before state, after state is current)
 */
function recordSimpleAction(beforeState) {
    if (isUndoing) return;
    
    const afterState = saveStateForUndo();
    recordAction(beforeState, afterState);
    
    // Mark sketch as dirty (for save/load system)
    if (typeof markSketchDirty === 'function') {
        markSketchDirty();
    }
}

/**
 * Undo the last action
 */
function undo() {
    if (undoStack.length === 0) return;
    
    isUndoing = true;
    
    const action = undoStack.pop();
    restoreState(action.beforeState);
    
    // Push to redo stack
    redoStack.push(action);
    
    isUndoing = false;
    
    drawCanvas();
    updateStatus();
}

/**
 * Redo the last undone action
 */
function redo() {
    if (redoStack.length === 0) return;
    
    isUndoing = true;
    
    const action = redoStack.pop();
    restoreState(action.afterState);
    
    // Push back to undo stack
    undoStack.push(action);
    
    isUndoing = false;
    
    drawCanvas();
    updateStatus();
}

/**
 * Clear both undo and redo stacks
 */
function clearUndoRedoStacks() {
    undoStack = [];
    redoStack = [];
}

/**
 * Check if undo is available
 */
function canUndo() {
    return undoStack.length > 0;
}

/**
 * Check if redo is available
 */
function canRedo() {
    return redoStack.length > 0;
}

// ============================================
// SKETCH EXPORT/IMPORT FUNCTIONS
// ============================================

/**
 * Export current sketch state as a plain object for serialization
 * Returns {points, segments, polygons} with plain arrays/objects
 */
function exportSketchState() {
    return {
        points: sketch.points.map(p => ({ x: p.x, y: p.y })),
        segments: sketch.segments.map(seg => ({ start: seg.start, end: seg.end })),
        polygons: sketch.polygons.map(poly => ({ vertices: poly.vertices.slice() }))
    };
}

/**
 * Import sketch state from a plain object
 * Restores points, segments, polygons and clears undo/redo stacks
 */
function importSketchState(state) {
    if (!state) return;
    
    sketch.points = state.points ? state.points.map(p => ({ x: p.x, y: p.y })) : [];
    sketch.segments = state.segments ? state.segments.map(seg => ({ start: seg.start, end: seg.end })) : [];
    sketch.polygons = state.polygons ? state.polygons.map(poly => ({ vertices: poly.vertices.slice() })) : [];
    
    // Clear all drawing states
    isDrawing = false;
    previewPoint = null;
    startPointIndex = null;
    newPointAdded = false;
    isDrawingPolygon = false;
    polygonVertices = [];
    polygonStartIndex = null;
    window.polygonBeforeState = null; // Clean up saved state
    polygonAddedPoints = [];
    
    // Clear selection states
    moveVertexCandidates = [];
    moveClosestEdge = null;
    moveClosestEdges = [];
    deletionCandidates = [];
    polygonDeletionCandidates = [];
    
    // Clear undo/redo stacks
    clearUndoRedoStacks();
    
    drawCanvas();
    updateStatus();
}

/**
 * Compare two sketch states for equality
 * Returns true if states are identical, false otherwise
 */
function compareSketchStates(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    
    // Compare points
    if (a.points.length !== b.points.length) return false;
    for (let i = 0; i < a.points.length; i++) {
        if (a.points[i].x !== b.points[i].x || a.points[i].y !== b.points[i].y) {
            return false;
        }
    }
    
    // Compare segments
    if (a.segments.length !== b.segments.length) return false;
    for (let i = 0; i < a.segments.length; i++) {
        if (a.segments[i].start !== b.segments[i].start || 
            a.segments[i].end !== b.segments[i].end) {
            return false;
        }
    }
    
    // Compare polygons
    if (a.polygons.length !== b.polygons.length) return false;
    for (let i = 0; i < a.polygons.length; i++) {
        if (a.polygons[i].vertices.length !== b.polygons[i].vertices.length) return false;
        for (let j = 0; j < a.polygons[i].vertices.length; j++) {
            if (a.polygons[i].vertices[j] !== b.polygons[i].vertices[j]) {
                return false;
            }
        }
    }
    
    return true;
}
