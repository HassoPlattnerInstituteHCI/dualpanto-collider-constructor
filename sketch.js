// sketch.js - 2D Sketch Data and Drawing Logic

// Canvas reference (initialized on DOM load)
let canvas;
let ctx;

// Sketch data model
const sketch = {
    points: [],       // Array of {x: number, y: number} in mm
    segments: []      // Array of {start: index, end: index} referencing points
};

// Viewport constants
const MIN_SCALE = 0.01;   // Minimum zoom (very far out)
const MAX_SCALE = 200;    // Maximum zoom (very close in)
const ZOOM_FACTOR = 1.03; // Zoom multiplier per wheel tick
const SNAP_RADIUS = 5;   // pixels - radius for snapping to existing points

// Grid granularity (user adjustable)
let gridGranularity = 0.1; // 1.0 = default, 0.1-2.0 range

// Viewport state
const viewport = {
    offsetX: 0,    // mm at center of canvas
    offsetY: 0,    // mm at center of canvas
    scale: 2,      // pixels per mm
    panX: 0,       // panning offset in pixels
    panY: 0        // panning offset in pixels
};

// Panning state
let isPanning = false;
let panStart = { x: 0, y: 0 };
let spaceKeyPressed = false;

// Deletion state
let isDeleting = false;           // Toggle state for delete mode
let deletionCandidates = [];     // Array of segment indices to delete
let optionKeyPressed = false;    // Track Option/Alt key state

// Drawing state
let isDrawing = false;
let previewPoint = null;
let startPointIndex = null;
let newPointAdded = false;

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
    if (effectiveScale >= 0.5) return 3;   // Zoomed out: 5mm
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
    viewport.offsetY = 0;
    viewport.scale = 2;
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
 * Find all segments that pass through the grid cell at the given MM position
 * Returns array of segment indices
 */
function findDeletionCandidates(mmX, mmY) {
    const gridSpacing = getAdaptiveGridSpacing();
    const cell = getGridCell(mmX, mmY);
    const candidates = [];
    
    sketch.segments.forEach((seg, idx) => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        if (segmentIntersectsGridCell(p1, p2, cell.x, cell.y, gridSpacing)) {
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
    
    // Find points that are still referenced by remaining segments
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
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
    sketch.points = [];
    sketch.segments = [];
    isDrawing = false;
    previewPoint = null;
    startPointIndex = null;
    newPointAdded = false;
}

function computeBoundingBox() {
    if (sketch.points.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
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
        segmentCount: sketch.segments.length
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
    
    // Draw points
    ctx.fillStyle = '#4a90e2';
    sketch.points.forEach(p => {
        const pixel = mmToPixel(p.x, p.y);
        ctx.beginPath();
        ctx.arc(pixel.x, pixel.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawPreview() {
    if (isDrawing && startPointIndex !== null) {
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
    if (isDeleting || optionKeyPressed) {
        if (type === 'move') {
            // Update deletion candidates as cursor moves
            deletionCandidates = findDeletionCandidates(snappedMM.x, snappedMM.y);
            drawCanvas();
        } else if (type === 'up') {
            // Delete the candidates on click release
            if (deletionCandidates.length > 0) {
                deleteSegments(deletionCandidates);
                deletionCandidates = [];
                drawCanvas();
            }
        }
        return;  // Don't handle drawing in deletion mode
    }
    
    // Original drawing logic
    if (type === 'down') {
        if (!isDrawing) {
            const nearestIndex = findNearestPoint(snappedMM.x, snappedMM.y, SNAP_RADIUS / viewport.scale);
            
            if (nearestIndex !== null) {
                startPointIndex = nearestIndex;
                isDrawing = true;
                previewPoint = null;
                newPointAdded = false;
            } else {
                startPointIndex = sketch.points.length;
                sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
                isDrawing = true;
                previewPoint = null;
                newPointAdded = true;
            }
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
                    const nearestIndex = findNearestPoint(previewPoint.x, previewPoint.y, SNAP_RADIUS / viewport.scale);
                    let endPointIndex;
                    let endPointAdded = false;
                    
                    if (nearestIndex !== null) {
                        endPointIndex = nearestIndex;
                    } else {
                        endPointIndex = sketch.points.length;
                        sketch.points.push({ x: previewPoint.x, y: previewPoint.y });
                        endPointAdded = true;
                    }
                    
                    // Don't create zero-length segments (same start and end point or same coordinates)
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
                    } else if (endPointAdded) {
                        // Remove the end point that was added but not used
                        sketch.points.pop();
                    }
                }
            }
            
            // If a new point was added but no segment was created, remove the orphaned point
            if (newPointAdded && !segmentCreated) {
                sketch.points.pop();
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
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = 600;
        drawCanvas();
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Mouse event listeners
    // Track spacebar state for panning
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            spaceKeyPressed = true;
            e.preventDefault();
        }
        // Track Option/Alt key for deletion mode
        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'Option') {
            optionKeyPressed = true;
            e.preventDefault();
        }
    });
    
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            spaceKeyPressed = false;
            e.preventDefault();
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
        
        // Check if this is a pan gesture (middle mouse button or Space + left click)
        if (e.button === 1 || (e.button === 0 && spaceKeyPressed)) {
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
