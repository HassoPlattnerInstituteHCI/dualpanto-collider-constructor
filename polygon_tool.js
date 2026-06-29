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

function drawPolygonToolPreview(){
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