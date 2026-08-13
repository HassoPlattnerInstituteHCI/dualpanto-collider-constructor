// ============================================
// RECTANGLE OBSTACLE INPUT HANDLING
// ============================================

/**
 * Handle rectangle obstacle drawing input
 * @param {string} type - 'down', 'move', or 'up'
 * @param {Object} snappedMM - {x, y} snapped to grid/existing points
 */
function handleRectangleObstacleInput(type, snappedMM) {
    if (type === 'down') {
        // Save state before adding any points for this rectangle obstacle
        const obstacleRectangleBeforeState = saveStateForUndo();
        
        if (!isDrawingRectangleObstacle) {
            // Start a new rectangle obstacle
            obstacleRectangleAddedPoints = []; // Reset tracking for new rectangle obstacle
            
            // ALWAYS create a new point, even when snapping to existing ones
            // This allows independent vertex movement in the move tool
            obstacleRectangleStartIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            obstacleRectangleAddedPoints.push(obstacleRectangleStartIndex);
            isDrawingRectangleObstacle = true;
            previewPoint = null; // Reset preview point for new rectangle obstacle
            
            // Store the before state in a window variable for later use
            window.obstacleRectangleBeforeState = obstacleRectangleBeforeState;
            
            drawCanvas();
        } else {
            // Second click: complete the rectangle obstacle
            const startPt = sketch.points[obstacleRectangleStartIndex];
            const endPt = snappedMM;
            
            // Calculate all four corners of the axis-aligned rectangle
            const minX = Math.min(startPt.x, endPt.x);
            const maxX = Math.max(startPt.x, endPt.x);
            const minY = Math.min(startPt.y, endPt.y);
            const maxY = Math.max(startPt.y, endPt.y);
            
            // Check if rectangle has zero area (both spanning points in same spot)
            const rectWidth = maxX - minX;
            const rectHeight = maxY - minY;
            
            // If rectangle has zero area, clean up and don't create it
            if (rectWidth < 0.01 && rectHeight < 0.01) {
                // Clean up orphaned points - they won't be referenced by any obstacle
                removeRectangleObstacleOrphanedPoints();
                
                // Clear the stored before state since we didn't create a rectangle obstacle
                window.obstacleRectangleBeforeState = null;
                
                // Reset rectangle obstacle drawing state
                isDrawingRectangleObstacle = false;
                obstacleRectangleStartIndex = null;
                obstacleRectangleAddedPoints = [];
                previewPoint = null;
                
                drawCanvas();
                updateStatus();
                return;
            }
            
            // Create the four corners of the rectangle
            const cornerIndices = [];
            
            // Corner 1: start point (minX, minY) or (maxX, maxY) depending on drag direction
            // We need to create all 4 corners and then figure out which ones we already have
            const allCorners = [
                { x: minX, y: minY },
                { x: maxX, y: minY },
                { x: maxX, y: maxY },
                { x: minX, y: maxY }
            ];
            
            // Map each corner to an index (either existing or new)
            const cornerToIndex = new Map();
            const gridSpacing = getAdaptiveGridSpacing();
            const threshold = gridSpacing * 0.1;
            
            // Check existing points first (including the start point)
            for (let i = 0; i < allCorners.length; i++) {
                const corner = allCorners[i];
                
                // Check if this corner already exists in our sketch
                let foundIndex = -1;
                for (let j = 0; j < sketch.points.length; j++) {
                    const pt = sketch.points[j];
                    const dx = corner.x - pt.x;
                    const dy = corner.y - pt.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < threshold) {
                        foundIndex = j;
                        break;
                    }
                }
                
                if (foundIndex === -1) {
                    // Create new point
                    foundIndex = sketch.points.length;
                    sketch.points.push(corner);
                    obstacleRectangleAddedPoints.push(foundIndex);
                }
                
                cornerToIndex.set(i, foundIndex);
            }
            
            // Get the four corner indices in order
            const vertices = [
                cornerToIndex.get(0), // bottom-left (minX, minY)
                cornerToIndex.get(1), // bottom-right (maxX, minY)
                cornerToIndex.get(2), // top-right (maxX, maxY)
                cornerToIndex.get(3)  // top-left (minX, maxY)
            ];
            
            // Create the polygon obstacle
            sketch.obstacles.push({
                vertices: vertices
            });
            
            // Record the action for undo
            if (window.obstacleRectangleBeforeState) {
                recordSimpleAction(window.obstacleRectangleBeforeState);
                window.obstacleRectangleBeforeState = null;
            }
            
            // Reset rectangle obstacle drawing state
            isDrawingRectangleObstacle = false;
            obstacleRectangleStartIndex = null;
            obstacleRectangleAddedPoints = [];
            previewPoint = null;
            
            drawCanvas();
            updateStatus();
        }
    } else if (type === 'move') {
        if (isDrawingRectangleObstacle) {
            // Update preview point for cursor tracking
            previewPoint = snappedMM;
            drawCanvas();
        }
    }
}

function drawRectangleObstacleToolPreview(){
    const startPt = sketch.points[obstacleRectangleStartIndex];
    const startPixel = mmToPixel(startPt.x, startPt.y);
    
    if (previewPoint) {
        // Calculate rectangle corners based on start point and preview point
        const previewPt = previewPoint;
        const minX = Math.min(startPt.x, previewPt.x);
        const maxX = Math.max(startPt.x, previewPt.x);
        const minY = Math.min(startPt.y, previewPt.y);
        const maxY = Math.max(startPt.y, previewPt.y);
        
        // Convert to pixels
        const corner1Px = mmToPixel(minX, minY);
        const corner2Px = mmToPixel(maxX, minY);
        const corner3Px = mmToPixel(maxX, maxY);
        const corner4Px = mmToPixel(minX, maxY);
        
        // Draw rectangle preview (dashed dark gray to match polygon obstacle tool)
        ctx.strokeStyle = '#202020';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(corner1Px.x, corner1Px.y);
        ctx.lineTo(corner2Px.x, corner2Px.y);
        ctx.lineTo(corner3Px.x, corner3Px.y);
        ctx.lineTo(corner4Px.x, corner4Px.y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw preview point
        const previewPixel = mmToPixel(previewPt.x, previewPt.y);
        ctx.fillStyle = '#202020';
        ctx.beginPath();
        ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Highlight the start point
        ctx.fillStyle = '#404040';
        ctx.beginPath();
        ctx.arc(startPixel.x, startPixel.y, 5, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // Highlight the start point
        ctx.fillStyle = '#404040';
        ctx.beginPath();
        ctx.arc(startPixel.x, startPixel.y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * Remove orphaned points that were added during rectangle obstacle drawing
 * Call this when rectangle obstacle is discarded (Escape or mouseleave)
 */
function removeRectangleObstacleOrphanedPoints() {
    if (obstacleRectangleAddedPoints.length === 0) return;
    
    // Create a set of indices to delete
    const indicesToDelete = new Set(obstacleRectangleAddedPoints);
    
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
    
    // Clear the tracking array
    obstacleRectangleAddedPoints = [];
}
