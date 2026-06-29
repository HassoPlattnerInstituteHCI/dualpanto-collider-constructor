// ============================================
// ORTHOGONAL LINE HELPERS
// ============================================

/**
 * Check if a point lies on an existing segment or polygon edge
 * @param {Object} point - The point to check {x, y}
 * @param {number} excludeSeg1 - Optional segment index to exclude from check
 * @param {number} excludeSeg2 - Optional second segment index to exclude from check
 * @returns {Object|null} - Returns {axis: 'x'|'y', coord: number} if point lies on a segment, null otherwise
 */
function getConstraintFromExistingGeometry(point, excludeSeg1 = null, excludeSeg2 = null) {
    const threshold = getAdaptiveGridSpacing() * 0.1; // Small threshold for on-segment detection
    
    // Check all segments
    for (let i = 0; i < sketch.segments.length; i++) {
        if (i === excludeSeg1 || i === excludeSeg2) continue;
        
        const seg = sketch.segments[i];
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        
        const dist = distanceToSegment(point.x, point.y, p1, p2);
        if (dist < threshold) {
            // Point lies on this segment, determine its direction
            if (p1.x === p2.x) {
                return { axis: 'x', coord: p1.x }; // Vertical segment
            } else if (p1.y === p2.y) {
                return { axis: 'y', coord: p1.y }; // Horizontal segment
            } else {
                // Diagonal segment - determine primary direction
                const dx = Math.abs(p2.x - p1.x);
                const dy = Math.abs(p2.y - p1.y);
                if (dx > dy) {
                    return { axis: 'y', coord: point.y }; // Segment is more horizontal, constrain to vertical
                } else {
                    return { axis: 'x', coord: point.x }; // Segment is more vertical, constrain to horizontal
                }
            }
        }
    }
    
    // Check polygon edges
    for (const poly of sketch.polygons) {
        if (poly.vertices.length < 2) continue;
        
        for (let i = 0; i < poly.vertices.length; i++) {
            const startIdx = poly.vertices[i];
            const endIdx = poly.vertices[(i + 1) % poly.vertices.length];
            const p1 = sketch.points[startIdx];
            const p2 = sketch.points[endIdx];
            
            const dist = distanceToSegment(point.x, point.y, p1, p2);
            if (dist < threshold) {
                // Point lies on this polygon edge, determine its direction
                if (p1.x === p2.x) {
                    return { axis: 'x', coord: p1.x }; // Vertical edge
                } else if (p1.y === p2.y) {
                    return { axis: 'y', coord: p1.y }; // Horizontal edge
                } else {
                    // Diagonal edge - determine primary direction
                    const dx = Math.abs(p2.x - p1.x);
                    const dy = Math.abs(p2.y - p1.y);
                    if (dx > dy) {
                        return { axis: 'y', coord: point.y }; // Edge is more horizontal, constrain to vertical
                    } else {
                        return { axis: 'x', coord: point.x }; // Edge is more vertical, constrain to horizontal
                    }
                }
            }
        }
    }
    
    return null; // No constraint found
}

/**
 * Calculate the geometry for an orthogonal line between two points
 * @param {Object} A - Start point {x, y}
 * @param {Object} B - End point {x, y}
 * @param {Object|null} ol - OrthoLine object (for excluding its own segments from constraint detection)
 * @param {number|null} userBendCoord - User-defined bend coordinate, if any
 * @returns {Object} - Geometry info with isStraight, bendAxis, bendCoord, P, Q
 */
function calculateOrthoGeometry(A, B, ol = null, userBendCoord = null) {
    const minX = Math.min(A.x, B.x);
    const maxX = Math.max(A.x, B.x);
    const minY = Math.min(A.y, B.y);
    const maxY = Math.max(A.y, B.y);
    const width = maxX - minX;
    const height = maxY - minY;
    const gridSpacing = getAdaptiveGridSpacing();
    
    // Check if already axis-aligned (straight line)
    if (A.x === B.x || A.y === B.y) {
        return {
            isStraight: true,
            bendAxis: null,
            bendCoord: null,
            P: null,
            Q: null
        };
    }
    
    // Determine longer axis
    let bendAxis, bendCoord, P, Q;
    
    if (width >= height) {
        // Horizontal: arms are horizontal, connector is vertical
        bendAxis = 'x';
        // Use user-defined bend coordinate if available and valid
        if (userBendCoord !== null && userBendCoord >= minX && userBendCoord <= maxX) {
            bendCoord = Math.round(userBendCoord / gridSpacing) * gridSpacing;
        } else {
            // Default to middle
            bendCoord = Math.round((A.x + B.x) / 2 / gridSpacing) * gridSpacing;
        }
        P = { x: bendCoord, y: A.y };
        Q = { x: bendCoord, y: B.y };
    } else {
        // Vertical: arms are vertical, connector is horizontal
        bendAxis = 'y';
        // Use user-defined bend coordinate if available and valid
        if (userBendCoord !== null && userBendCoord >= minY && userBendCoord <= maxY) {
            bendCoord = Math.round(userBendCoord / gridSpacing) * gridSpacing;
        } else {
            // Default to middle
            bendCoord = Math.round((A.y + B.y) / 2 / gridSpacing) * gridSpacing;
        }
        P = { x: A.x, y: bendCoord };
        Q = { x: B.x, y: bendCoord };
    }
    
    return {
        isStraight: false,
        bendAxis,
        bendCoord,
        P,
        Q
    };
}

/**
 * Update an orthogonal line's geometry after its endpoints have moved
 * @param {Object} ol - The orthoLine object to update
 */
function updateOrthoLine(ol) {
    const A = sketch.points[ol.startPoint];
    const B = sketch.points[ol.endPoint];
    const gridSpacing = getAdaptiveGridSpacing();
    
    // Recalculate geometry
    const geometry = calculateOrthoGeometry(A, B, ol, ol.userBendCoord);
    
    if (geometry.isStraight) {
        // Update to straight mode
        ol.isStraight = true;
        ol.bendAxis = null;
        ol.bendCoord = null;
        
        // If we previously had junction points and segments, move them to create a straight line
        if (ol.junction1 !== undefined && ol.junction2 !== undefined) {
            // Move junction points to create a direct path A-B
            // Move P to A and Q to B, making segments A-P and Q-B have zero length
            // This will cause seg2 (P-Q) to become A-B
            // The zero-length segments will be preserved (not cleaned up) to maintain orthoLine structure
            sketch.points[ol.junction1] = { ...sketch.points[ol.startPoint], type: 'orthoJunction' };
            sketch.points[ol.junction2] = { ...sketch.points[ol.endPoint], type: 'orthoJunction' };
            
            // Update segments to create A-B directly
            if (ol.seg1 !== undefined) {
                sketch.segments[ol.seg1] = { start: ol.startPoint, end: ol.junction1 }; // A-P (P=A)
            }
            if (ol.seg2 !== undefined) {
                sketch.segments[ol.seg2] = { start: ol.junction1, end: ol.junction2 }; // P-Q (P=A, Q=B)
            }
            if (ol.seg3 !== undefined) {
                sketch.segments[ol.seg3] = { start: ol.junction2, end: ol.endPoint }; // Q-B (Q=B)
            }
        }
    } else {
        // Update bend information
        ol.bendAxis = geometry.bendAxis;
        ol.bendCoord = geometry.bendCoord;
        ol.isStraight = false;
        
        // Check if endpoints have moved inward past seg2, in which case reset userBendCoord
        if (ol.userBendCoord !== null) {
            if (geometry.bendAxis === 'x') {
                // Vertical connector (seg2), check if endpoints align with bend coordinate
                if (A.x === geometry.bendCoord || B.x === geometry.bendCoord) {
                    // Endpoint has reached seg2, reset user bend coordinate
                    ol.userBendCoord = null;
                }
            } else if (geometry.bendAxis === 'y') {
                // Horizontal connector (seg2), check if endpoints align with bend coordinate
                if (A.y === geometry.bendCoord || B.y === geometry.bendCoord) {
                    // Endpoint has reached seg2, reset user bend coordinate
                    ol.userBendCoord = null;
                }
            }
        }
        
        // Update or create junction points
        const P = geometry.P;
        const Q = geometry.Q;
        
        if (ol.junction1 === undefined) {
            // First time creating junctions for this line (was straight, now becoming bendy)
            // If we had a straight segment (seg1 was A-B), update it to be A-P
            
            ol.junction1 = sketch.points.length;
            sketch.points.push({ ...P, type: 'orthoJunction' });
            ol.junction2 = sketch.points.length;
            sketch.points.push({ ...Q, type: 'orthoJunction' });
            
            // Update or create segments
            if (ol.seg1 !== undefined) {
                // Update existing seg1 from A-B to A-P
                sketch.segments[ol.seg1] = { start: ol.startPoint, end: ol.junction1 };
            } else {
                // Create seg1
                ol.seg1 = sketch.segments.length;
                sketch.segments.push({ start: ol.startPoint, end: ol.junction1 });
            }
            
            // Create seg2 (P-Q)
            ol.seg2 = sketch.segments.length;
            sketch.segments.push({ start: ol.junction1, end: ol.junction2 });
            
            // Create seg3 (Q-B)
            ol.seg3 = sketch.segments.length;
            sketch.segments.push({ start: ol.junction2, end: ol.endPoint });
        } else {
            // Update existing junction points
            sketch.points[ol.junction1] = { ...P, type: 'orthoJunction' };
            sketch.points[ol.junction2] = { ...Q, type: 'orthoJunction' };
        }
    }
}

/**
 * Get orthoLine by segment index
 * @param {number} segIndex - Segment index
 * @returns {Object|null} - The orthoLine or null if not found
 */
function getOrthoLineBySegment(segIndex) {
    for (const ol of sketch.orthoLines) {
        if (ol.seg1 === segIndex || ol.seg2 === segIndex || ol.seg3 === segIndex) {
            return ol;
        }
    }
    return null;
}

/**
 * Get orthoLine by point index (endpoint or junction)
 * @param {number} pointIndex - Point index
 * @returns {Object|null} - The orthoLine or null if not found
 */
function getOrthoLineByPoint(pointIndex) {
    for (const ol of sketch.orthoLines) {
        if (ol.startPoint === pointIndex || 
            ol.endPoint === pointIndex || 
            ol.junction1 === pointIndex || 
            ol.junction2 === pointIndex) {
            return ol;
        }
    }
    return null;
}

/**
 * Get all orthoLines that have a specific point as an endpoint
 * @param {number} pointIndex - Point index
 * @returns {Array} - Array of orthoLine objects
 */
function getOrthoLinesForEndpoint(pointIndex) {
    return sketch.orthoLines.filter(ol => 
        ol.startPoint === pointIndex || ol.endPoint === pointIndex
    );
}

/**
 * Check if a point is an ortho junction
 * @param {number} pointIndex - Point index
 * @returns {boolean}
 */
function isOrthoJunction(pointIndex) {
    if (pointIndex === undefined || pointIndex >= sketch.points.length) return false;
    return sketch.points[pointIndex].type === 'orthoJunction';
}

/**
 * Check if a segment is part of an orthoLine's connector (seg2)
 * @param {number} segIndex - Segment index
 * @returns {boolean}
 */
function isOrthoConnectorSegment(segIndex) {
    const ol = getOrthoLineBySegment(segIndex);
    return ol !== null && ol.seg2 === segIndex;
}

/**
 * Get the constraint axis for an orthoLine connector segment
 * @param {number} segIndex - Segment index
 * @returns {'x' | 'y' | null} - Constraint axis or null
 */
function getOrthoConnectorConstraint(segIndex) {
    const ol = getOrthoLineBySegment(segIndex);
    if (ol && ol.seg2 === segIndex) {
        return ol.bendAxis; // 'x' for horizontal movement, 'y' for vertical movement
    }
    return null;
}

/**
 * Remove orphaned points added during orthogonal line drawing
 */
function removeOrthogonalOrphanedPoints() {
    if (orthoAddedPoints.length === 0) return;
    
    const indicesToDelete = new Set(orthoAddedPoints);
    
    // Find all point indices that are still referenced
    const usedPointIndices = new Set();
    sketch.segments.forEach(seg => {
        usedPointIndices.add(seg.start);
        usedPointIndices.add(seg.end);
    });
    sketch.polygons.forEach(poly => {
        poly.vertices.forEach(vIdx => usedPointIndices.add(vIdx));
    });
    sketch.orthoLines.forEach(ol => {
        if (ol.startPoint !== undefined) usedPointIndices.add(ol.startPoint);
        if (ol.endPoint !== undefined) usedPointIndices.add(ol.endPoint);
        if (ol.junction1 !== undefined) usedPointIndices.add(ol.junction1);
        if (ol.junction2 !== undefined) usedPointIndices.add(ol.junction2);
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
    
    // Remap orthoLine point indices
    sketch.orthoLines.forEach(ol => {
        if (ol.startPoint !== undefined) ol.startPoint = pointMap.get(ol.startPoint);
        if (ol.endPoint !== undefined) ol.endPoint = pointMap.get(ol.endPoint);
        if (ol.junction1 !== undefined) ol.junction1 = pointMap.get(ol.junction1);
        if (ol.junction2 !== undefined) ol.junction2 = pointMap.get(ol.junction2);
    });
    
    // Clear the tracking array
    orthoAddedPoints = [];
}

function drawOrthogonalToolPreview(){
    const startPt = sketch.points[orthoStartIndex];
    const startPixel = mmToPixel(startPt.x, startPt.y);
    
    if (previewPoint) {
        const geometry = calculateOrthoGeometry(startPt, previewPoint, null);
        
        if (geometry.isStraight) {
            // Draw straight line preview
            const previewPixel = mmToPixel(previewPoint.x, previewPoint.y);
            ctx.strokeStyle = '#0066cc';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(startPixel.x, startPixel.y);
            ctx.lineTo(previewPixel.x, previewPixel.y);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw preview end point
            ctx.fillStyle = '#0066cc';
            ctx.beginPath();
            ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Draw 3-segment orthogonal path preview
            const pPx = mmToPixel(geometry.P.x, geometry.P.y);
            const qPx = mmToPixel(geometry.Q.x, geometry.Q.y);
            const previewPixel = mmToPixel(previewPoint.x, previewPoint.y);
            
            ctx.strokeStyle = '#0066cc';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            
            // Draw A-P
            ctx.beginPath();
            ctx.moveTo(startPixel.x, startPixel.y);
            ctx.lineTo(pPx.x, pPx.y);
            ctx.stroke();
            
            // Draw P-Q
            ctx.beginPath();
            ctx.moveTo(pPx.x, pPx.y);
            ctx.lineTo(qPx.x, qPx.y);
            ctx.stroke();
            
            // Draw Q-B
            ctx.beginPath();
            ctx.moveTo(qPx.x, qPx.y);
            ctx.lineTo(previewPixel.x, previewPixel.y);
            ctx.stroke();
            
            ctx.setLineDash([]);
            
            // Draw preview junction points (smaller, semi-transparent)
            ctx.fillStyle = 'rgba(0, 102, 204, 0.5)';
            ctx.beginPath();
            ctx.arc(pPx.x, pPx.y, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(qPx.x, qPx.y, 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw preview end point
            ctx.fillStyle = '#0066cc';
            ctx.beginPath();
            ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        // Highlight the start point
        ctx.fillStyle = '#0066cc';
        ctx.beginPath();
        ctx.arc(startPixel.x, startPixel.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ============================================
// ORTHOGONAL LINE INPUT HANDLING
// ============================================

/**
 * Handle orthogonal line drawing input
 * @param {string} type - 'down', 'move', or 'up'
 * @param {Object} snappedMM - {x, y} snapped to grid/existing points
 */
function handleOrthogonalInput(type, snappedMM) {
    if (type === 'down') {
        // Save state before adding any points for this orthogonal line
        const orthoBeforeState = saveStateForUndo();
        
        if (!isDrawingOrthogonal) {
            // Start a new orthogonal line
            orthoAddedPoints = []; // Reset tracking for new orthogonal line
            
            // ALWAYS create a new point, even when snapping to existing ones
            // This allows independent vertex movement in the move tool
            orthoStartIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            orthoAddedPoints.push(orthoStartIndex);
            isDrawingOrthogonal = true;
            previewPoint = null; // Reset preview point for new orthogonal line
            
            // Store the before state in a window variable for later use
            window.orthoBeforeState = orthoBeforeState;
            
            drawCanvas();
        } else {
            // Second click: complete the orthogonal line
            const startPt = sketch.points[orthoStartIndex];
            const endPointIndex = sketch.points.length;
            sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
            orthoAddedPoints.push(endPointIndex);
            
            // Calculate geometry
            const geometry = calculateOrthoGeometry(startPt, snappedMM, null);
            
            // Create the orthoLine object
            const orthoLine = {
                startPoint: orthoStartIndex,
                endPoint: endPointIndex,
                isStraight: geometry.isStraight,
                bendAxis: geometry.bendAxis,
                bendCoord: geometry.bendCoord,
                userBendCoord: null  // null means use calculated bendCoord, otherwise use this user-defined value
            };
            
            if (!geometry.isStraight) {
                // Create junction points and segments for non-straight lines
                const P = geometry.P;
                const Q = geometry.Q;
                
                orthoLine.junction1 = sketch.points.length;
                sketch.points.push({ ...P, type: 'orthoJunction' });
                orthoAddedPoints.push(orthoLine.junction1);
                
                orthoLine.junction2 = sketch.points.length;
                sketch.points.push({ ...Q, type: 'orthoJunction' });
                orthoAddedPoints.push(orthoLine.junction2);
                
                // Create segments
                orthoLine.seg1 = sketch.segments.length;
                sketch.segments.push({ start: orthoStartIndex, end: orthoLine.junction1 });
                
                orthoLine.seg2 = sketch.segments.length;
                sketch.segments.push({ start: orthoLine.junction1, end: orthoLine.junction2 });
                
                orthoLine.seg3 = sketch.segments.length;
                sketch.segments.push({ start: orthoLine.junction2, end: endPointIndex });
            } else {
                // For straight lines, create a single segment
                orthoLine.seg1 = sketch.segments.length;
                sketch.segments.push({ start: orthoStartIndex, end: endPointIndex });
                orthoLine.seg2 = undefined;
                orthoLine.seg3 = undefined;
            }
            
            // Add to orthoLines array
            sketch.orthoLines.push(orthoLine);
            
            // Record the action for undo
            if (window.orthoBeforeState) {
                recordSimpleAction(window.orthoBeforeState);
                window.orthoBeforeState = null;
            }
            
            // Reset orthogonal drawing state
            isDrawingOrthogonal = false;
            orthoStartIndex = null;
            orthoAddedPoints = [];
            previewPoint = null;
            
            drawCanvas();
            updateStatus();
        }
    } else if (type === 'move') {
        if (isDrawingOrthogonal) {
            // Update preview point for cursor tracking
            previewPoint = snappedMM;
            drawCanvas();
        }
    }
}