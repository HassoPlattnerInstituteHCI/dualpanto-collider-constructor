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
        points: sketch.points.map(p => ({ x: p.x, y: p.y, type: p.type })),
        segments: sketch.segments.map(seg => ({ start: seg.start, end: seg.end })),
        polygons: sketch.polygons.map(poly => ({ vertices: poly.vertices.slice() })),
        orthoLines: sketch.orthoLines.map(ol => ({
            startPoint: ol.startPoint,
            endPoint: ol.endPoint,
            junction1: ol.junction1,
            junction2: ol.junction2,
            seg1: ol.seg1,
            seg2: ol.seg2,
            seg3: ol.seg3,
            bendAxis: ol.bendAxis,
            bendCoord: ol.bendCoord,
            userBendCoord: ol.userBendCoord,
            isStraight: ol.isStraight
        }))
    };
}

/**
 * Restore sketch state from saved state
 */
function restoreState(state) {
    sketch.points = state.points.map(p => ({ x: p.x, y: p.y, type: p.type }));
    sketch.segments = state.segments.map(seg => ({ start: seg.start, end: seg.end }));
    sketch.polygons = state.polygons.map(poly => ({ vertices: poly.vertices.slice() }));
    sketch.orthoLines = state.orthoLines ? state.orthoLines.map(ol => ({
        startPoint: ol.startPoint,
        endPoint: ol.endPoint,
        junction1: ol.junction1,
        junction2: ol.junction2,
        seg1: ol.seg1,
        seg2: ol.seg2,
        seg3: ol.seg3,
        bendAxis: ol.bendAxis,
        bendCoord: ol.bendCoord,
        userBendCoord: ol.userBendCoord,
        isStraight: ol.isStraight
    })) : [];
    
    // Clear move vertex candidates to prevent stale highlights
    moveVertexCandidates = [];
    moveClosestEdge = null;
    moveClosestEdges = [];
    moveConstraintAxis = null;
    
    // Clear deletion candidates to prevent stale highlights
    deletionCandidates = [];
    polygonDeletionCandidates = [];
    
    // Update cursor
    updateCanvasCursor();
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
 * Returns {points, segments, polygons, orthoLines} with plain arrays/objects
 */
function exportSketchState() {
    return {
        points: sketch.points.map(p => ({ x: p.x, y: p.y, type: p.type })),
        segments: sketch.segments.map(seg => ({ start: seg.start, end: seg.end })),
        polygons: sketch.polygons.map(poly => ({ vertices: poly.vertices.slice() })),
        orthoLines: sketch.orthoLines.map(ol => ({
            startPoint: ol.startPoint,
            endPoint: ol.endPoint,
            junction1: ol.junction1,
            junction2: ol.junction2,
            seg1: ol.seg1,
            seg2: ol.seg2,
            seg3: ol.seg3,
            bendAxis: ol.bendAxis,
            bendCoord: ol.bendCoord,
            userBendCoord: ol.userBendCoord,
            isStraight: ol.isStraight
        }))
    };
}

/**
 * Import sketch state from a plain object
 * Restores points, segments, polygons, orthoLines and clears undo/redo stacks
 */
function importSketchState(state) {
    if (!state) return;
    
    sketch.points = state.points ? state.points.map(p => ({ x: p.x, y: p.y, type: p.type })) : [];
    sketch.segments = state.segments ? state.segments.map(seg => ({ start: seg.start, end: seg.end })) : [];
    sketch.polygons = state.polygons ? state.polygons.map(poly => ({ vertices: poly.vertices.slice() })) : [];
    sketch.orthoLines = state.orthoLines ? state.orthoLines.map(ol => ({
        startPoint: ol.startPoint,
        endPoint: ol.endPoint,
        junction1: ol.junction1,
        junction2: ol.junction2,
        seg1: ol.seg1,
        seg2: ol.seg2,
        seg3: ol.seg3,
        bendAxis: ol.bendAxis,
        bendCoord: ol.bendCoord,
        userBendCoord: ol.userBendCoord,
        isStraight: ol.isStraight
    })) : [];
    
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
    isDrawingRectangle = false;
    rectangleStartIndex = null;
    window.rectangleBeforeState = null; // Clean up saved state
    rectangleAddedPoints = [];
    isDrawingOrthogonal = false;
    orthoStartIndex = null;
    window.orthoBeforeState = null; // Clean up saved state
    orthoAddedPoints = [];
    
    // Clear selection states
    moveVertexCandidates = [];
    moveClosestEdge = null;
    moveClosestEdges = [];
    moveConstraintAxis = null;
    deletionCandidates = [];
    polygonDeletionCandidates = [];
    
    // Clear undo/redo stacks
    clearUndoRedoStacks();
    
    // Update cursor
    updateCanvasCursor();
    
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

function clearSketch() {
    // Save state before clearing for undo
    const beforeState = saveStateForUndo();
    
    sketch.points = [];
    sketch.segments = [];
    sketch.polygons = [];
    sketch.orthoLines = [];
    isDrawing = false;
    previewPoint = null;
    startPointIndex = null;
    newPointAdded = false;
    isDrawingPolygon = false;
    polygonVertices = [];
    polygonStartIndex = null;
    polygonAddedPoints = [];
    isDrawingRectangle = false;
    rectangleStartIndex = null;
    rectangleAddedPoints = [];
    isDrawingOrthogonal = false;
    orthoStartIndex = null;
    orthoAddedPoints = [];
    polygonDeletionCandidates = [];
    deletionCandidates = [];
    moveVertexCandidates = [];
    moveClosestEdge = null;
    moveClosestEdges = [];
    moveConstraintAxis = null;
    window.polygonBeforeState = null; // Clean up saved state
    window.rectangleBeforeState = null; // Clean up saved state
    window.orthoBeforeState = null; // Clean up saved state
    
    // Update cursor
    updateCanvasCursor();
    
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