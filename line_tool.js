// ============================================
// LINE INPUT HANDLING
// ============================================
/**
 * Handle line drawing input
 * @param {string} type - 'down', 'move', or 'up'
 * @param {Object} snappedMM - {x, y} snapped to grid/existing points
 */
function handleLineInput(type, snappedMM) {
    // Line drawing logic
    if (type === 'down') {
        // Save state before adding the first point for undo
        const beforeState = saveStateForUndo();
        
        if (!isDrawing) {
            // First click: create start point
            // ALWAYS create a new point, even when snapping to existing ones
            // This allows independent vertex movement in the move tool
            const newIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            startPointIndex = newIndex;
            isDrawing = true;
            newPointAdded = true;
            
            // Store beforeState for potential undo
            window.lineDrawBeforeState = beforeState;
            
            drawCanvas();
        } else {
            // Second click: create end point and finalize the line
            isDrawing = false;
            
            let segmentCreated = false;
            const startPt = sketch.points[startPointIndex];
            
            // ALWAYS create a new end point, even when snapping
            const endPointIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            
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
            
            // If a new point was added but no segment was created, remove the orphaned start point
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
    } else if (type === 'move') {
        if (isDrawing) {
            // Show preview from start point to current mouse position
            previewPoint = { x: snappedMM.x, y: snappedMM.y };
            drawCanvas();
        }
    }
}

function drawLineToolPreview(){
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
 * Delete segments by index and remove orphaned points
 * Rebuilds points array and remaps segment indices
 */
function deleteSegments(segmentIndices) {
    const indicesToDelete = new Set(segmentIndices);
    
    // Remove orthoLines that have ALL their segments being deleted
    // Only remove an orthoLine if all its defined segments are being deleted
    sketch.orthoLines = sketch.orthoLines.filter(ol => {
        const seg1Deleted = ol.seg1 !== undefined && indicesToDelete.has(ol.seg1);
        const seg2Deleted = ol.seg2 !== undefined && indicesToDelete.has(ol.seg2);
        const seg3Deleted = ol.seg3 !== undefined && indicesToDelete.has(ol.seg3);
        
        // Count how many of its segments are being deleted vs how many it has
        const totalSegments = (ol.seg1 !== undefined ? 1 : 0) + (ol.seg2 !== undefined ? 1 : 0) + (ol.seg3 !== undefined ? 1 : 0);
        const deletedSegments = (seg1Deleted ? 1 : 0) + (seg2Deleted ? 1 : 0) + (seg3Deleted ? 1 : 0);
        
        // Only remove orthoLine if ALL its segments are being deleted
        return deletedSegments < totalSegments;
    });
    
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
 * But preserve segments that belong to orthoLines to maintain their structure
 */
function cleanupZeroLengthSegments() {
    const zeroLengthIndices = [];
    
    // Collect all segment indices that belong to orthoLines
    const orthoLineSegments = new Set();
    sketch.orthoLines.forEach(ol => {
        if (ol.seg1 !== undefined) orthoLineSegments.add(ol.seg1);
        if (ol.seg2 !== undefined) orthoLineSegments.add(ol.seg2);
        if (ol.seg3 !== undefined) orthoLineSegments.add(ol.seg3);
    });
    
    sketch.segments.forEach((seg, idx) => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        
        // Skip zero-length segments that belong to orthoLines to preserve their structure
        if ((seg.start === seg.end || dist < 0.01) && !orthoLineSegments.has(idx)) {
            zeroLengthIndices.push(idx);
        }
    });
    
    if (zeroLengthIndices.length > 0) {
        deleteSegments(zeroLengthIndices);
    }
}