// sketch.js - 2D Sketch Data and Drawing Logic

// Canvas reference (initialized on DOM load)
let canvas;
let ctx;

// Sketch data model
const sketch = {
    points: [],       // Array of {x: number, y: number, type?: string} in mm
    segments: [],     // Array of {start: index, end: index} referencing points
    polygons: [],      // Array of {vertices: [index, index, ...]} for polygon cutouts
    orthoLines: []     // Array of orthoLine objects for orthogonal line connections
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
    offsetY: -85,      // mm at center of canvas
    scale: 4,         // pixels per mm
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
let currentTool = 'line';         // 'line' | 'polygon' | 'delete' | 'rectangle' | 'orthogonal'

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

// Rectangle drawing state
let isDrawingRectangle = false;
let rectangleStartIndex = null;  // Index of first corner point
let rectangleAddedPoints = [];   // Track indices of points added during rectangle drawing

// Orthogonal line drawing state
let isDrawingOrthogonal = false;
let orthoStartIndex = null;     // Index of first endpoint
let orthoAddedPoints = [];      // Track indices of points added during orthogonal line drawing

// Move vertex tool state
let isMovingVertex = false;
let moveVertexCandidates = [];  // Array of point indices to move
let dragStartMM = null;          // Starting MM position of drag
let dragOriginalPositions = null; // Original positions of vertices being moved
let moveClosestEdge = null;     // Edge info for highlighting the closest edge (backwards compat)
let moveClosestEdges = [];      // Array of all edges at minimum distance for highlighting
let moveConstraintAxis = null;  // 'x' or 'y' for constrained movement (ortho connector)

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
    viewport.offsetY = -85;
    viewport.scale = 4;
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
 * Find all segments that are within a threshold distance from the given MM position
 * For orthoLines, if any segment is selected, all 3 segments are added
 * Returns array of segment indices
 */
function findDeletionCandidates(mmX, mmY) {
    const threshold = getAdaptiveGridSpacing() * 0.5; // Half a grid cell
    const candidates = [];
    const addedOrthoLines = new Set(); // Track orthoLines already added
    
    sketch.segments.forEach((seg, idx) => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const dist = distanceToSegment(mmX, mmY, p1, p2);
        
        if (dist < threshold) {
            // Check if this segment belongs to an orthoLine
            const ol = getOrthoLineBySegment(idx);
            if (ol) {
                // Add all segments of this orthoLine
                if (!addedOrthoLines.has(ol)) {
                    addedOrthoLines.add(ol);
                    if (ol.seg1 !== undefined) candidates.push(ol.seg1);
                    if (ol.seg2 !== undefined) candidates.push(ol.seg2);
                    if (ol.seg3 !== undefined) candidates.push(ol.seg3);
                }
            } else {
                // Regular segment
                candidates.push(idx);
            }
        }
    });
    
    return candidates;
}

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
        ctx.lineWidth = 3;  // Bold line
        
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
    
    // Draw points (skip orthoJunction points)
    ctx.fillStyle = '#4a90e2';
    sketch.points.forEach(p => {
        // Skip orthoJunction points - they're internal and shouldn't be visible
        if (p.type === 'orthoJunction') return;
        
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
        drawLineToolPreview();
    }
    
    // Draw polygon tool preview
    if (currentTool === 'polygon' && isDrawingPolygon && polygonVertices.length > 0) {
        drawPolygonToolPreview();
    }
    
    // Draw rectangle tool preview
    if (currentTool === 'rectangle' && isDrawingRectangle && rectangleStartIndex !== null) {
        drawRectangleToolPreview();
    }
    
    // Draw orthogonal tool preview
    if (currentTool === 'orthogonal' && isDrawingOrthogonal && orthoStartIndex !== null) {
        drawOrthogonalToolPreview()
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
    
    // Rectangle drawing logic
    if (currentTool === 'rectangle') {
        handleRectangleInput(type, snappedMM);
        return;
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
    
    // Orthogonal line drawing logic
    if (currentTool === 'orthogonal') {
        handleOrthogonalInput(type, snappedMM);
        return;
    }

    // Line drawing logic
    if (currentTool === 'line') {
        handleLineInput(type, snappedMM);
        return;
    }
    
    
}

// ============================================
// CANVAS CURSOR MANAGEMENT
// ============================================

/**
 * Update the canvas cursor based on current tool and selection state
 */
function updateCanvasCursor() {
    if (!canvas) return;
    
    // Remove all cursor classes first
    canvas.classList.remove('move-cursor');
    
    // Add move cursor when in move tool and there are highlighted elements
    if (currentTool === 'move' && 
        (moveVertexCandidates.length > 0 || moveClosestEdges.length > 0)) {
        canvas.classList.add('move-cursor');
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
        
        // Line tool keyboard shortcuts
        if (currentTool === 'line') {
            if (e.code === 'Escape') {
                // Cancel line drawing
                if (isDrawing) {
                    isDrawing = false;
                    previewPoint = null;
                    startPointIndex = null;
                    if (newPointAdded) {
                        sketch.points.pop();
                        newPointAdded = false;
                    }
                    window.lineDrawBeforeState = null; // Clean up saved state
                    drawCanvas();
                    updateStatus();
                }
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
        
        // Rectangle tool keyboard shortcuts
        if (currentTool === 'rectangle') {
            if (e.code === 'Escape') {
                // Cancel rectangle drawing
                if (isDrawingRectangle) {
                    isDrawingRectangle = false;
                    rectangleStartIndex = null;
                    window.rectangleBeforeState = null; // Clean up saved state
                    removeRectangleOrphanedPoints();
                    drawCanvas();
                    updateStatus();
                }
                e.preventDefault();
            }
        }
        
        // Orthogonal tool keyboard shortcuts
        if (currentTool === 'orthogonal') {
            if (e.code === 'Escape') {
                // Cancel orthogonal line drawing
                if (isDrawingOrthogonal) {
                    isDrawingOrthogonal = false;
                    orthoStartIndex = null;
                    previewPoint = null;
                    window.orthoBeforeState = null; // Clean up saved state
                    removeOrthogonalOrphanedPoints();
                    drawCanvas();
                    updateStatus();
                }
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
        if (isDrawingRectangle) {
            // Cancel rectangle drawing on mouse leave
            isDrawingRectangle = false;
            rectangleStartIndex = null;
            previewPoint = null;
            window.rectangleBeforeState = null; // Clean up saved state
            removeRectangleOrphanedPoints();
            drawCanvas();
        }
        if (isDrawingOrthogonal) {
            // Cancel orthogonal drawing on mouse leave
            isDrawingOrthogonal = false;
            orthoStartIndex = null;
            previewPoint = null;
            window.orthoBeforeState = null; // Clean up saved state
            removeOrthogonalOrphanedPoints();
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