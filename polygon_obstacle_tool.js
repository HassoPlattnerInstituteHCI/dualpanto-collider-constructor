// ============================================
// POLYGON OBSTACLE INPUT HANDLING
// ============================================

/**
 * Handle polygon obstacle drawing input
 * @param {string} type - 'down', 'move', or 'up'
 * @param {Object} snappedMM - {x, y} snapped to grid/existing points
 */
function handlePolygonObstacleInput(type, snappedMM) {
    if (type === 'down') {
        // Find nearest existing point (for snapping, but we'll create a new point)
        const nearestIndex = findNearestPoint(snappedMM.x, snappedMM.y, SNAP_RADIUS / viewport.scale);
        
        if (!isDrawingPolygonObstacle) {
            // Start a new polygon obstacle
            obstacleAddedPoints = []; // Reset tracking for new polygon obstacle
            
            // Save state before adding any points for this polygon obstacle
            const obstacleBeforeState = saveStateForUndo();
            
            // ALWAYS create a new point, even when snapping to existing ones
            // This allows independent vertex movement in the move tool
            obstacleStartIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            obstacleVertices = [obstacleStartIndex];
            obstacleAddedPoints.push(obstacleStartIndex);
            isDrawingPolygonObstacle = true;
            previewPoint = null; // Reset preview point for new polygon obstacle
            
            // Store the before state in a window variable for later use
            window.obstacleBeforeState = obstacleBeforeState;
            
            drawCanvas();
        } else {
            // Continuing an existing polygon obstacle
            // Check if clicked on first vertex (to close polygon obstacle)
            // We need to check if the snapped position is close to the first vertex's position
            if (obstacleVertices.length >= 3) {
                const firstVertex = sketch.points[obstacleStartIndex];
                const distToFirst = Math.hypot(
                    snappedMM.x - firstVertex.x,
                    snappedMM.y - firstVertex.y
                );
                if (distToFirst < SNAP_RADIUS / viewport.scale) {
                    // Use the state saved when starting the polygon obstacle
                    const beforeState = window.obstacleBeforeState;
                    
                    // Close the polygon obstacle - check for overlapping vertices first
                    const cleanedVertices = removeOverlappingPolygonVertices([...obstacleVertices]);
                    sketch.obstacles.push({
                        vertices: cleanedVertices
                    });
                    
                    // Record the action for undo
                    if (beforeState) {
                        recordSimpleAction(beforeState);
                        window.obstacleBeforeState = null;
                    }
                    
                    // Reset polygon obstacle drawing state
                    isDrawingPolygonObstacle = false;
                    obstacleVertices = [];
                    obstacleStartIndex = null;
                    obstacleAddedPoints = [];
                    previewPoint = null;
                    
                    drawCanvas();
                    updateStatus();
                    return;
                }
            }
            
            // ALWAYS create a new point for polygon obstacle vertices
            const newIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            
            // Check if this new point overlaps with any existing vertex in obstacleVertices
            const threshold = getAdaptiveGridSpacing() * 0.1;
            let isDuplicate = false;
            const newPoint = sketch.points[newIndex];
            
            for (const existingIdx of obstacleVertices) {
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
                obstacleVertices.push(newIndex);
                obstacleAddedPoints.push(newIndex);
            } else {
                // Remove the duplicate point we just added
                sketch.points.pop();
            }
            
            drawCanvas();
        }
    } else if (type === 'move') {
        if (isDrawingPolygonObstacle) {
            // Update preview point for cursor tracking
            previewPoint = snappedMM;
            drawCanvas();
        }
    }
}

function drawPolygonObstacleToolPreview(){
    // Get the current mouse position for preview
    const previewPixel = previewPoint ? mmToPixel(previewPoint.x, previewPoint.y) : null;
    
    // Draw preview line from last vertex to cursor
    if (previewPixel) {
        const lastVertex = sketch.points[obstacleVertices[obstacleVertices.length - 1]];
        const lastPixel = mmToPixel(lastVertex.x, lastVertex.y);
        
        // Draw preview line (dark gray dashed for obstacles)
        ctx.strokeStyle = '#202020';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(lastPixel.x, lastPixel.y);
        ctx.lineTo(previewPixel.x, previewPixel.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw preview point
        ctx.fillStyle = '#202020';
        ctx.beginPath();
        ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Highlight the first vertex to show where to click to close
    const firstVertex = sketch.points[obstacleStartIndex];
    const firstPixel = mmToPixel(firstVertex.x, firstVertex.y);
    ctx.fillStyle = '#404040';
    ctx.beginPath();
    ctx.arc(firstPixel.x, firstPixel.y, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw current polygon obstacle vertices being placed (as a preview polygon with dashed lines)
    if (obstacleVertices.length > 1) {
        ctx.strokeStyle = '#202020';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const firstPx = mmToPixel(sketch.points[obstacleVertices[0]].x, sketch.points[obstacleVertices[0]].y);
        ctx.moveTo(firstPx.x, firstPx.y);
        for (let i = 1; i < obstacleVertices.length; i++) {
            const px = mmToPixel(sketch.points[obstacleVertices[i]].x, sketch.points[obstacleVertices[i]].y);
            ctx.lineTo(px.x, px.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

/**
 * Remove orphaned points that were added during polygon obstacle drawing
 * Call this when polygon obstacle is discarded (Escape or mouseleave)
 */
function removePolygonObstacleOrphanedPoints() {
    if (obstacleAddedPoints.length === 0) return;
    
    // Create a set of indices to delete for use in the deleteSegments pattern
    const indicesToDelete = new Set(obstacleAddedPoints);
    
    // Find all point indices that are still referenced
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
    });
    sketch.polygons.forEach(poly => {
        poly.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
    });
    sketch.obstacles.forEach(obstacle => {
        obstacle.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
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
    
    // Remap obstacle vertex indices
    sketch.obstacles.forEach(obstacle => {
        obstacle.vertices = obstacle.vertices.map(vIdx => pointMap.get(vIdx));
    });
    
    // Remap orthoLine point references
    sketch.orthoLines.forEach(ol => {
        if (ol.startPoint !== undefined) ol.startPoint = pointMap.get(ol.startPoint);
        if (ol.endPoint !== undefined) ol.endPoint = pointMap.get(ol.endPoint);
        if (ol.junction1 !== undefined) ol.junction1 = pointMap.get(ol.junction1);
        if (ol.junction2 !== undefined) ol.junction2 = pointMap.get(ol.junction2);
    });
    
    // Clear the tracking array
    obstacleAddedPoints = [];
}

// ============================================
// POLYGON OBSTACLE DELETION HELPERS
// ============================================

/**
 * Find polygon obstacle deletion candidates at a given position
 * @param {number} mmX - X coordinate in mm
 * @param {number} mmY - Y coordinate in mm
 * @returns {Array} - Array of obstacle indices that contain the point
 */
function findPolygonObstacleDeletionCandidates(mmX, mmY) {
    const candidates = [];
    const point = { x: mmX, y: mmY };
    
    sketch.obstacles.forEach((obstacle, idx) => {
        if (obstacle.vertices.length >= 3 && pointInPolygon(point, obstacle.vertices)) {
            candidates.push(idx);
        }
    });
    
    return candidates;
}

/**
 * Delete polygon obstacles by index and remove orphaned points
 */
function deleteObstacles(obstacleIndices) {
    const indicesToDelete = new Set(obstacleIndices);
    
    // Remove obstacles
    sketch.obstacles = sketch.obstacles.filter((_, idx) => !indicesToDelete.has(idx));
    
    // Find all point indices used by remaining segments, polygons, and obstacles
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
    });
    sketch.polygons.forEach(poly => {
        poly.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
    });
    sketch.obstacles.forEach(obstacle => {
        obstacle.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
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
    
    // Remap obstacle vertex indices to new point indices
    sketch.obstacles.forEach(obstacle => {
        obstacle.vertices = obstacle.vertices.map(vIdx => pointMap.get(vIdx));
    });
    
    // Remap orthoLine point references to new point indices
    sketch.orthoLines.forEach(ol => {
        if (ol.startPoint !== undefined) ol.startPoint = pointMap.get(ol.startPoint);
        if (ol.endPoint !== undefined) ol.endPoint = pointMap.get(ol.endPoint);
        if (ol.junction1 !== undefined) ol.junction1 = pointMap.get(ol.junction1);
        if (ol.junction2 !== undefined) ol.junction2 = pointMap.get(ol.junction2);
    });
    
    obstacleDeletionCandidates = [];
    updateStatus();
}
