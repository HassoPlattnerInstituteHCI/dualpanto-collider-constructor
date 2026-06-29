// ============================================
// MOVE VERTEX HELPERS
// ============================================

/**
 * Find all line vertices that lie on a specific edge
 * @param {number} edgeStart - Start point index of the edge
 * @param {number} edgeEnd - End point index of the edge
 * @returns {Array} - Array of line vertex indices that lie on this edge
 */
function findVerticesOnEdge(edgeStart, edgeEnd) {
    const verticesOnEdge = [];
    const threshold = getAdaptiveGridSpacing() * 0.1; // Small threshold for on-edge detection
    const edgeStartPt = sketch.points[edgeStart];
    const edgeEndPt = sketch.points[edgeEnd];
    
    // Check each line segment endpoint to see if it lies on this edge
    sketch.segments.forEach(seg => {
        const lineStart = sketch.points[seg.start];
        const lineEnd = sketch.points[seg.end];
        
        // Check if line start point is on this edge
        const distStartToEdge = distanceToSegment(lineStart.x, lineStart.y, edgeStartPt, edgeEndPt);
        if (distStartToEdge < threshold) {
            // Make sure this vertex isn't already one of the edge endpoints and isn't an ortho junction
            if (seg.start !== edgeStart && seg.start !== edgeEnd && !verticesOnEdge.includes(seg.start) && !isOrthoJunction(seg.start)) {
                verticesOnEdge.push(seg.start);
            }
        }
        
        // Check if line end point is on this edge
        const distEndToEdge = distanceToSegment(lineEnd.x, lineEnd.y, edgeStartPt, edgeEndPt);
        if (distEndToEdge < threshold) {
            // Make sure this vertex isn't already one of the edge endpoints and isn't an ortho junction
            if (seg.end !== edgeStart && seg.end !== edgeEnd && !verticesOnEdge.includes(seg.end) && !isOrthoJunction(seg.end)) {
                verticesOnEdge.push(seg.end);
            }
        }
    });
    
    return verticesOnEdge;
}

/**
 * Find all line vertices that lie on the perimeter of a polygon
 * @param {Object} poly - Polygon with vertices array
 * @returns {Array} - Array of point indices that lie on polygon edges
 */
function findVerticesOnPolygonPerimeter(poly) {
    const verticesOnPerimeter = [];
    const threshold = getAdaptiveGridSpacing() * 0.1; // Small threshold for on-edge detection
    
    // Check each line segment endpoint to see if it lies on any polygon edge
    sketch.segments.forEach(seg => {
        const lineStart = sketch.points[seg.start];
        const lineEnd = sketch.points[seg.end];
        
        // Check if either endpoint of the line lies on any polygon edge
        for (let i = 0; i < poly.vertices.length; i++) {
            const polyStart = sketch.points[poly.vertices[i]];
            const polyEnd = sketch.points[poly.vertices[(i + 1) % poly.vertices.length]];
            
            // Check if line start point is on this polygon edge
            const distStartToEdge = distanceToSegment(lineStart.x, lineStart.y, polyStart, polyEnd);
            if (distStartToEdge < threshold) {
                // Make sure this vertex isn't already a polygon vertex and isn't an ortho junction
                if (!poly.vertices.includes(seg.start) && !verticesOnPerimeter.includes(seg.start) && !isOrthoJunction(seg.start)) {
                    verticesOnPerimeter.push(seg.start);
                }
            }
            
            // Check if line end point is on this polygon edge
            const distEndToEdge = distanceToSegment(lineEnd.x, lineEnd.y, polyStart, polyEnd);
            if (distEndToEdge < threshold) {
                // Make sure this vertex isn't already a polygon vertex and isn't an ortho junction
                if (!poly.vertices.includes(seg.end) && !verticesOnPerimeter.includes(seg.end) && !isOrthoJunction(seg.end)) {
                    verticesOnPerimeter.push(seg.end);
                }
            }
        }
    });
    
    return verticesOnPerimeter;
}

/**
 * Find vertices that should be highlighted/moved based on cursor position.
 * Selection algorithm:
 * 1. Check for edge selection: if cursor is closer to an edge than grid size,
 *    the edge is the unique closest, and cursor is farther from both vertices
 *    than min(gridSize, edgeLength/4), select both edge vertices
 * 2. Find all vertices closer to cursor than currently visible grid size
 * 3. If these vertices are in multiple locations, select only those at the location closest to cursor
 * 4. From these vertices, select only those connected to the edge which is closest to cursor
 * 5. If cursor is inside a polygon with no close vertices, select all polygon vertices + perimeter line vertices
 * 
 * @param {number} mmX - Cursor X position in mm
 * @param {number} mmY - Cursor Y position in mm
 * @returns {Array} - Array of point indices to highlight/move
 */
function findMoveVertexCandidates(mmX, mmY) {
    const gridSpacing = getAdaptiveGridSpacing();
    const point = { x: mmX, y: mmY };
    
    // Reset edge selection state and constraint
    moveClosestEdge = null;
    moveClosestEdges = [];
    moveConstraintAxis = null;
    
    // Check if cursor is inside any polygon (for fallback when no vertices are close)
    const polygonContainingCursor = sketch.polygons.find(poly => 
        poly.vertices.length >= 3 && pointInPolygon(point, poly.vertices)
    );
    
    // Build all edges (segments + polygon edges) with their distances and lengths
    const allEdges = [];
    
    const addEdge = (startIdx, endIdx, isPolygon, segIdx) => {
        const p1 = sketch.points[startIdx];
        const p2 = sketch.points[endIdx];
        const dist = distanceToSegment(mmX, mmY, p1, p2);
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const isOrthoConnector = !isPolygon && isOrthoConnectorSegment(segIdx);
        const bendAxis = isOrthoConnector ? getOrthoConnectorConstraint(segIdx) : null;
        allEdges.push({ start: startIdx, end: endIdx, dist, length, isPolygon, segIdx, isOrthoConnector, bendAxis });
    };
    
    sketch.segments.forEach((seg, segIdx) => addEdge(seg.start, seg.end, false, segIdx));
    sketch.polygons.forEach((poly, polyIdx) => {
        if (poly.vertices.length < 2) return;
        for (let i = 0; i < poly.vertices.length; i++) {
            const startIdx = poly.vertices[i];
            const endIdx = poly.vertices[(i + 1) % poly.vertices.length];
            addEdge(startIdx, endIdx, true, polyIdx);
        }
    });
    
    // ============================================
    // Edge Selection (Priority 1): Select entire edge if conditions met
    // ============================================
    const closeEdges = allEdges.filter(e => e.dist < gridSpacing);
    if (closeEdges.length > 0) {
        const minDist = Math.min(...closeEdges.map(e => e.dist));
        const edgesAtMinDist = closeEdges.filter(e => Math.abs(e.dist - minDist) < 0.001);
        
        if (edgesAtMinDist.length === 1) {
            const edge = edgesAtMinDist[0];
            const p1 = sketch.points[edge.start];
            const p2 = sketch.points[edge.end];
            const threshold = Math.min(gridSpacing, edge.length * 0.25);
            const distToStart = Math.hypot(p1.x - mmX, p1.y - mmY);
            const distToEnd = Math.hypot(p2.x - mmX, p2.y - mmY);
            
            if (distToStart > threshold && distToEnd > threshold) {
                moveClosestEdge = edge;
                moveClosestEdges = [edge];
                
                // Set constraint axis for ortho connector edges
                moveConstraintAxis = edge.isOrthoConnector ? edge.bendAxis : null;
                
                updateCanvasCursor();
                return [edge.start, edge.end, edge.start, edge.end];
            }
        }
    }
    
    // ============================================
    // Vertex Selection (Priority 2): Find close vertices
    // ============================================
    const closeVertices = sketch.points
        .map((p, idx) => ({ idx, dist: Math.hypot(p.x - mmX, p.y - mmY) }))
        .filter(({ dist, idx }) => dist < gridSpacing && !isOrthoJunction(idx))
        .map(({ idx }) => idx);
    
    // If no close vertices and cursor is inside a polygon, select entire polygon + perimeter
    if (closeVertices.length === 0) {
        if (polygonContainingCursor) {
            const polyVertices = [...polygonContainingCursor.vertices];
            const perimeterVertices = findVerticesOnPolygonPerimeter(polygonContainingCursor);
            const allVerticesToMove = [...polyVertices, ...perimeterVertices];
            
            moveClosestEdge = null;
            moveClosestEdges = polyVertices.map((startIdx, i) => ({
                start: startIdx,
                end: polyVertices[(i + 1) % polyVertices.length],
                isPolygon: true
            }));
            moveConstraintAxis = null;
            updateCanvasCursor();
            return allVerticesToMove;
        }
        
        moveClosestEdge = null;
        moveClosestEdges = [];
        moveConstraintAxis = null;
        updateCanvasCursor();
        return [];
    }
    
    // ============================================
    // Group vertices by location and find closest group
    // ============================================
    const GROUP_PRECISION = 0.001;
    const locationGroups = [];
    
    for (const idx of closeVertices) {
        const p = sketch.points[idx];
        const existingGroup = locationGroups.find(g => 
            Math.abs(p.x - g.avgX) < GROUP_PRECISION && Math.abs(p.y - g.avgY) < GROUP_PRECISION
        );
        
        if (existingGroup) {
            existingGroup.pointIndices.push(idx);
            const total = existingGroup.pointIndices.length;
            existingGroup.avgX = existingGroup.avgX * (total - 1) / total + p.x / total;
            existingGroup.avgY = existingGroup.avgY * (total - 1) / total + p.y / total;
        } else {
            locationGroups.push({ pointIndices: [idx], avgX: p.x, avgY: p.y });
        }
    }
    
    const closestGroup = locationGroups.reduce((closest, group) => {
        const dist = Math.hypot(group.avgX - mmX, group.avgY - mmY);
        return dist < closest.dist ? { group, dist } : closest;
    }, { group: null, dist: Infinity }).group;
    
    if (!closestGroup || closestGroup.pointIndices.length === 0) {
        moveClosestEdge = null;
        moveClosestEdges = [];
        moveConstraintAxis = null;
        updateCanvasCursor();
        return [];
    }
    
    // ============================================
    // Select vertices with closest connected edges
    // ============================================
    const vertexEdges = new Map();
    closestGroup.pointIndices.forEach(vIdx => vertexEdges.set(vIdx, []));
    
    const addConnectedEdges = (startIdx, endIdx, isPolygon, segIdx) => {
        if (closestGroup.pointIndices.includes(startIdx)) {
            vertexEdges.get(startIdx).push({ segIdx, start: startIdx, end: endIdx, isPolygon });
        }
        if (closestGroup.pointIndices.includes(endIdx)) {
            vertexEdges.get(endIdx).push({ segIdx, start: startIdx, end: endIdx, isPolygon });
        }
    };
    
    sketch.segments.forEach((seg, segIdx) => addConnectedEdges(seg.start, seg.end, false, segIdx));
    sketch.polygons.forEach((poly, polyIdx) => {
        if (poly.vertices.length < 3) return;
        for (let i = 0; i < poly.vertices.length; i++) {
            const vIdx = poly.vertices[i];
            if (closestGroup.pointIndices.includes(vIdx)) {
                const prevIdx = poly.vertices[(i - 1 + poly.vertices.length) % poly.vertices.length];
                const nextIdx = poly.vertices[(i + 1) % poly.vertices.length];
                addConnectedEdges(prevIdx, vIdx, true, -polyIdx - 1);
                addConnectedEdges(vIdx, nextIdx, true, -polyIdx - 1);
            }
        }
    });
    
    // Find vertices with edges at minimum distance
    const vertexClosestEdgeDist = new Map();
    let globalClosestEdgeDist = Infinity;
    
    for (const [vIdx, edges] of vertexEdges) {
        const closestDist = edges.length === 0 ? Infinity : 
            Math.min(...edges.map(e => distanceToSegment(mmX, mmY, sketch.points[e.start], sketch.points[e.end])));
        vertexClosestEdgeDist.set(vIdx, closestDist);
        globalClosestEdgeDist = Math.min(globalClosestEdgeDist, closestDist);
    }
    
    if (globalClosestEdgeDist === Infinity) {
        moveClosestEdge = null;
        moveClosestEdges = [];
        moveConstraintAxis = null;
        updateCanvasCursor();
        return closestGroup.pointIndices;
    }
    
    // Collect vertices to select and edges for highlighting
    const selectedVertices = [];
    const closestEdges = [];
    const selectedEdgeKeys = new Set();
    
    for (const vIdx of closestGroup.pointIndices) {
        // If Command key is pressed, include ALL vertices at this location
        // Otherwise, only include vertices with edges at the globally closest distance
        if (commandKeyPressed || vertexClosestEdgeDist.get(vIdx) === globalClosestEdgeDist) {
            selectedVertices.push(vIdx);
            for (const edgeInfo of vertexEdges.get(vIdx)) {
                const edgeKey = `${edgeInfo.start},${edgeInfo.end}`;
                const key2 = `${edgeInfo.end},${edgeInfo.start}`;
                if (!selectedEdgeKeys.has(edgeKey) && !selectedEdgeKeys.has(key2) ) {
                    closestEdges.push(edgeInfo);
                    selectedEdgeKeys.add(edgeKey);
                }
            }
        }
    }
    
    moveClosestEdge = closestEdges.length > 0 ? closestEdges[0] : null;
    moveClosestEdges = closestEdges;
    updateCanvasCursor();
    
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
            
            // Calculate offset from the RAW drag start position to snapped current position
            // This allows vertices created on finer grids to snap properly to coarser grids
            let dx = snappedMM.x - dragStartMM.x;
            let dy = snappedMM.y - dragStartMM.y;
            
            // Apply constraint if set (for ortho connector movement)
            if (moveConstraintAxis === 'x') {
                // Constrain to horizontal movement only (x-axis)
                dy = 0;
            } else if (moveConstraintAxis === 'y') {
                // Constrain to vertical movement only (y-axis)
                dx = 0;
            }
            
            // Move all candidate vertices from their original positions by the offset
            // Then snap to grid to ensure vertices land exactly on grid points
            const gridSpacing = getAdaptiveGridSpacing();
            moveVertexCandidates.forEach(idx => {
                const newX = dragOriginalPositions.get(idx).x + dx;
                const newY = dragOriginalPositions.get(idx).y + dy;
                const snappedX = Math.round(newX / gridSpacing) * gridSpacing;
                const snappedY = Math.round(newY / gridSpacing) * gridSpacing;
                // Preserve the original point's type and other properties
                sketch.points[idx] = {
                    ...sketch.points[idx],
                    x: snappedX,
                    y: snappedY
                };
            });
            
            // If we moved ortho junction points, update the stored bend coordinate
            if (moveConstraintAxis && moveVertexCandidates.length === 2) {
                const idx1 = moveVertexCandidates[0];
                const idx2 = moveVertexCandidates[1];
                const ol = getOrthoLineByPoint(idx1);
                if (ol && ol.seg2 !== undefined) {
                    // Get the segment for this connector
                    const seg = sketch.segments[ol.seg2];
                    if (seg) {
                        const p1 = sketch.points[seg.start];
                        const p2 = sketch.points[seg.end];
                        // Update user bend coordinate based on new positions
                        // This remembers the user's manual positioning of seg2
                        if (moveConstraintAxis === 'x') {
                            // Vertical connector, bend coordinate is x
                            ol.userBendCoord = p1.x; // or p2.x, they should be the same
                        } else if (moveConstraintAxis === 'y') {
                            // Horizontal connector, bend coordinate is y
                            ol.userBendCoord = p1.y; // or p2.y, they should be the same
                        }
                    }
                }
            }
            
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
            
            // Update any orthoLines that have moved endpoints
            for (const idx of moveVertexCandidates) {
                const orthoLines = getOrthoLinesForEndpoint(idx);
                for (const ol of orthoLines) {
                    updateOrthoLine(ol, true); // duringDrag = true
                }
            }
            
            // Clean up any zero-length segments created by orthoLine updates
            // Note: zero-length segments belonging to orthoLines are preserved
            cleanupZeroLengthSegments();
            
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
            // Store the RAW (unsnapped) drag start position
            // This allows vertices to snap to grid properly even if they were
            // created on a finer grid
            dragStartMM = { x: mm.x, y: mm.y };
            
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
            updateCanvasCursor();
            drawCanvas();
        }
    }
}