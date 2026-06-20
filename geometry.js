// geometry.js - CSG-Based 3D Extrusion with Proper Mitered Joints

function computeBoundingBoxWithMargin(sketch, margin) {
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
    return {
        minX: minX - margin,
        maxX: maxX + margin,
        minY: minY - margin,
        maxY: maxY + margin
    };
}

function createCSGCube(centerX, centerY, centerZ, width, depth, height) {
    return CSG.cube({
        center: [centerX, centerY, centerZ],
        radius: [width / 2, depth / 2, height / 2]
    });
}

// ============================================================================
// MITER JOINT CALCULATION
// ============================================================================

/**
 * Calculate miter point for two line segments meeting at a point
 * The miter point is where the outer offset lines would intersect
 * @param {Object} p - Intersection point {x, y}
 * @param {Object} dir1 - Direction vector of first segment AWAY from p
 * @param {Object} dir2 - Direction vector of second segment AWAY from p
 * @param {number} offset - Offset distance (hallwayWidth/2)
 * @returns {Object|null} - Miter point {x, y}, or null if angle is too small
 */
function calculateMiterPoint(p, dir1, dir2, offset) {
    const len1 = Math.hypot(dir1.x, dir1.y);
    const len2 = Math.hypot(dir2.x, dir2.y);
    if (len1 < 0.001 || len2 < 0.001) return null;
    
    const u1 = { x: dir1.x / len1, y: dir1.y / len1 };
    const u2 = { x: dir2.x / len2, y: dir2.y / len2 };
    
    // Angle between the two directions
    const cosTheta = u1.x * u2.x + u1.y * u2.y;
    const sinTheta = Math.abs(u1.x * u2.y - u1.y * u2.x);
    const theta = Math.atan2(sinTheta, cosTheta);
    
    // For the miter, we use the formula: distance = offset / sin(theta/2)
    const sinHalfTheta = Math.sin(theta / 2);
    
    if (sinHalfTheta < 0.001) {
        // Parallel segments - miter would be infinite
        return null;
    }
    
    const miterDist = offset / sinHalfTheta;
    
    // Limit miter length to avoid extremely long miters for small angles
    if (miterDist > offset * 50) {
        return null;
    }
    
    // Angle bisector direction (unit vector)
    // The bisector of u1 and u2 is (u1 + u2) / |u1 + u2|
    const bisexX = u1.x + u2.x;
    const bisexY = u1.y + u2.y;
    const bisexLen = Math.hypot(bisexX, bisexY);
    
    if (bisexLen < 0.001) {
        // Opposite directions (180 degrees)
        return null;
    }
    
    // The bisector points INTO the angle. For the OUTER miter,
    // we need to go in the OPPOSITE direction (away from the angle)
    return {
        x: p.x - (bisexX / bisexLen) * miterDist,
        y: p.y - (bisexY / bisexLen) * miterDist
    };
}

/**
 * Get all segments connected to a point
 */
function getSegmentsAtPoint(sketch, pointIndex) {
    const segments = [];
    sketch.segments.forEach((seg, idx) => {
        if (seg.start === pointIndex || seg.end === pointIndex) {
            segments.push(idx);
        }
    });
    return segments;
}

/**
 * Get the direction vector from a point along a segment (away from the point)
 */
function getSegmentDirectionFrom(sketch, segIndex, fromPointIndex) {
    const seg = sketch.segments[segIndex];
    const otherIndex = seg.start === fromPointIndex ? seg.end : seg.start;
    const other = sketch.points[otherIndex];
    const from = sketch.points[fromPointIndex];
    return { x: other.x - from.x, y: other.y - from.y };
}

/**
 * For each intersection, pre-calculate miter points
 * Returns a map: miterPoints[pointIndex][segmentIndex] = {leftMiter: point, rightMiter: point}
 */
function calculateAllMiterPoints(sketch, hallwayWidth) {
    const halfW = hallwayWidth / 2;
    const miterMap = {}; // miterMap[pointIndex] = {segIndex: {leftMiter: {...}, rightMiter: {...}}}
    
    sketch.points.forEach((p, pIndex) => {
        const segments = getSegmentsAtPoint(sketch, pIndex);
        if (segments.length < 2) return;
        
        // Get direction vectors (away from p) for each segment
        const directions = segments.map(segIndex => 
            getSegmentDirectionFrom(sketch, segIndex, pIndex)
        );
        
        // Calculate angles and sort segments in CCW order
        const segmentAngles = segments.map((segIndex, i) => {
            const d = directions[i];
            return Math.atan2(d.y, d.x);
        });
        
        const sorted = segments.map((segIndex, i) => ({ segIndex, angle: segmentAngles[i] }))
            .sort((a, b) => a.angle - b.angle);
        
        // For each consecutive pair in the sorted order, calculate the outer miter
        for (let i = 0; i < sorted.length; i++) {
            const j = (i + 1) % sorted.length;
            const seg1 = sorted[i].segIndex;
            const seg2 = sorted[j].segIndex;
            
            // Get the directions in sorted order
            const dir1 = directions[segments.indexOf(seg1)];
            const dir2 = directions[segments.indexOf(seg2)];
            
            const miter = calculateMiterPoint(p, dir1, dir2, halfW);
            
            // Store this miter point
            // For seg1, this is the "right" miter (CCW side)
            // For seg2, this is the "left" miter (CW side)
            if (!miterMap[pIndex]) miterMap[pIndex] = {};
            if (!miterMap[pIndex][seg1]) miterMap[pIndex][seg1] = {};
            if (!miterMap[pIndex][seg2]) miterMap[pIndex][seg2] = {};
            
            miterMap[pIndex][seg1].rightMiter = miter;
            miterMap[pIndex][seg2].leftMiter = miter;
        }
    });
    
    return miterMap;
}

/**
 * Get perpendicular vector (90 degree rotation counter-clockwise)
 */
function perpVec(x, y) {
    return { x: -y, y: x };
}

/**
 * Scale a vector
 */
function scaleVec(v, s) {
    return { x: v.x * s, y: v.y * s };
}

/**
 * Add two vectors
 */
function addVec(v1, v2) {
    return { x: v1.x + v2.x, y: v1.y + v2.y };
}

/**
 * Create a tunnel prism with mitered ends
 * For each segment endpoint that is an intersection:
 * - One side wall ends at the intersection point (inner wall)
 * - The other side wall ends at the outer miter point
 */
function createTunnelPrism(sketch, segIndex, hallwayWidth, height, miterMap) {
    const seg = sketch.segments[segIndex];
    const p1 = sketch.points[seg.start];
    const p2 = sketch.points[seg.end];
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    
    if (length < 0.001) return null;
    
    // Unit direction vector
    const dir = { x: dx / length, y: dy / length };
    // Unit perpendicular vectors
    const perpLeft = perpVec(dir.x, dir.y);  // 90° CCW
    const perpRight = perpVec(perpLeft.x, perpLeft.y); // 90° CW (same as -90° CCW)
    
    const halfW = hallwayWidth / 2;
    const halfH = height / 2;
    const midZ = height / 2;
    
    // Check if endpoints are intersections
    const startSegments = getSegmentsAtPoint(sketch, seg.start);
    const endSegments = getSegmentsAtPoint(sketch, seg.end);
    const isStartIntersection = startSegments.length > 1;
    const isEndIntersection = endSegments.length > 1;
    
    // Get miter points for this segment
    const startMiters = isStartIntersection && miterMap[seg.start] ? miterMap[seg.start][segIndex] : null;
    const endMiters = isEndIntersection && miterMap[seg.end] ? miterMap[seg.end][segIndex] : null;
    
    // Calculate offset points at start
    let startLeftPt, startRightPt;
    if (isStartIntersection && startMiters) {
        // At intersection: use miter points if available, else use offset
        startLeftPt = startMiters.leftMiter || addVec(p1, scaleVec(perpLeft, halfW));
        startRightPt = startMiters.rightMiter || addVec(p1, scaleVec(perpRight, halfW));
    } else {
        // Simple offset at start
        startLeftPt = addVec(p1, scaleVec(perpLeft, halfW));
        startRightPt = addVec(p1, scaleVec(perpRight, halfW));
    }
    
    // Calculate offset points at end
    let endLeftPt, endRightPt;
    if (isEndIntersection && endMiters) {
        endLeftPt = endMiters.leftMiter || addVec(p2, scaleVec(perpLeft, halfW));
        endRightPt = endMiters.rightMiter || addVec(p2, scaleVec(perpRight, halfW));
    } else {
        // Simple offset at end
        endLeftPt = addVec(p2, scaleVec(perpLeft, halfW));
        endRightPt = addVec(p2, scaleVec(perpRight, halfW));
    }
    
    // Create 3D vertices with clear naming:
    // B=Back (at p1), F=Front (at p2), L=Left, R=Right, b=bottom, t=top
    const v3d = (x, y, z) => new CSG.Vertex([x, y, z], [0, 0, 1]);
    
    const blb = v3d(startLeftPt.x, startLeftPt.y, 0);   // Back-Left-Bottom
    const brb = v3d(startRightPt.x, startRightPt.y, 0); // Back-Right-Bottom
    const flb = v3d(endLeftPt.x, endLeftPt.y, 0);       // Front-Left-Bottom
    const frb = v3d(endRightPt.x, endRightPt.y, 0);    // Front-Right-Bottom
    const blt = v3d(startLeftPt.x, startLeftPt.y, height);   // Back-Left-Top
    const brt = v3d(startRightPt.x, startRightPt.y, height); // Back-Right-Top
    const flt = v3d(endLeftPt.x, endLeftPt.y, height);       // Front-Left-Top
    const frt = v3d(endRightPt.x, endRightPt.y, height);    // Front-Right-Top
    
    // 6 faces with correct CCW winding when viewed from outside
    // These windings work for any tunnel direction
    const bottom = new CSG.Polygon([blb, flb, frb, brb], null);  // Normal: (0,0,-1)
    const top = new CSG.Polygon([blt, brt, frt, flt], null);     // Normal: (0,0,+1)
    const back = new CSG.Polygon([blb, brb, brt, blt], null);   // Normal: opposite to dir
    const front = new CSG.Polygon([flb, flt, frt, frb], null);  // Normal: same as dir
    const left = new CSG.Polygon([blb, blt, flt, flb], null);    // Normal: same as perpLeft
    const right = new CSG.Polygon([brb, frb, frt, brt], null);  // Normal: opposite to perpLeft
    
    return CSG.fromPolygons([bottom, top, back, front, left, right]);
}

function createBaseCube(sketch, height, padding) {
    const bbox = computeBoundingBoxWithMargin(sketch, padding);
    const width = bbox.maxX - bbox.minX;
    const depth = bbox.maxY - bbox.minY;
    
    if (width <= 0 || depth <= 0 || height <= 0) {
        return createCSGCube(0, 0, height / 2, 10, 10, height);
    }
    
    return createCSGCube(
        (bbox.minX + bbox.maxX) / 2,
        (bbox.minY + bbox.maxY) / 2,
        height / 2,
        width, depth, height
    );
}

function generateCSGModel(sketch, extrusionHeight, hallwayWidth) {
    const padding = hallwayWidth * 2;
    let base = createBaseCube(sketch, extrusionHeight, padding);
    
    // Pre-calculate all miter points
    const miterMap = calculateAllMiterPoints(sketch, hallwayWidth);
    
    // Create tunnels with mitered ends
    sketch.segments.forEach((seg, segIndex) => {
        const tunnel = createTunnelPrism(sketch, segIndex, hallwayWidth, extrusionHeight, miterMap);
        if (tunnel) {
            base = base.subtract(tunnel);
        }
    });
    
    return base;
}

function generateOBJFromSketch(sketch, extrusionHeight, hallwayWidth) {
    const csgModel = generateCSGModel(sketch, extrusionHeight, hallwayWidth);
    return csgToOBJ(csgModel);
}
