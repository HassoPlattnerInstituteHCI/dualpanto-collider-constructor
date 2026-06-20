// geometry.js - 3D Extrusion with Miter Joints
// Standard miter joint: two offset lines meet at a point at angle bisector

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
// 2D OFFSET WITH STANDARD MITER JOINTS
// ============================================================================

/**
 * Calculate miter point for outer corner of two segments meeting at angle theta
 * Distance from corner to miter point = offset / sin(theta/2)
 */
function calcMiter(p, dir1, dir2, offset) {
    const len1 = Math.hypot(dir1.x, dir1.y);
    const len2 = Math.hypot(dir2.x, dir2.y);
    if (len1 < 0.001 || len2 < 0.001) return null;
    
    const u1 = { x: dir1.x / len1, y: dir1.y / len1 };
    const u2 = { x: dir2.x / len2, y: dir2.y / len2 };
    
    // Cosine of angle between vectors
    const cosTheta = u1.x * u2.x + u1.y * u2.y;
    // Avoid numerical issues
    const cosThetaClamped = Math.max(-1, Math.min(1, cosTheta));
    const theta = Math.acos(cosThetaClamped);
    
    const sinHalfTheta = Math.sin(theta / 2);
    if (sinHalfTheta < 0.001) return null; // Nearly parallel
    
    const miterDist = offset / sinHalfTheta;
    if (miterDist > offset * 50) return null; // Limit miter length
    
    // Bisector direction (points INTO the angle)
    const bisex = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bisexLen = Math.hypot(bisex.x, bisex.y);
    if (bisexLen < 0.001) return null; // Opposite directions
    
    // For OUTER miter, go in opposite direction of bisector
    return {
        x: p.x - (bisex.x / bisexLen) * miterDist,
        y: p.y - (bisex.y / bisexLen) * miterDist
    };
}

/**
 * Get all segments connected to a point
 */
function getSegmentsAtPoint(sketch, ptIdx) {
    const segs = [];
    sketch.segments.forEach((s, i) => {
        if (s.start === ptIdx || s.end === ptIdx) segs.push(i);
    });
    return segs;
}

/**
 * Get direction vector from point ptIdx along segment segIdx
 */
function getDirFrom(sketch, segIdx, ptIdx) {
    const s = sketch.segments[segIdx];
    const otherIdx = s.start === ptIdx ? s.end : s.start;
    const other = sketch.points[otherIdx];
    const pt = sketch.points[ptIdx];
    return { x: other.x - pt.x, y: other.y - pt.y };
}

/**
 * Calculate miter points for all intersections
 * Returns: miterMap[ptIdx][segIdx] = { left: point, right: point }
 */
function calcAllMiters(sketch, hw) {
    const halfW = hw / 2;
    const map = {};
    
    sketch.points.forEach((p, pIdx) => {
        const segs = getSegmentsAtPoint(sketch, pIdx);
        if (segs.length < 2) return;
        
        const dirs = segs.map(s => getDirFrom(sketch, s, pIdx));
        const angles = dirs.map(d => Math.atan2(d.y, d.x));
        
        // Sort segments by angle (CCW order)
        const sorted = segs.map((s, i) => ({ seg: s, angle: angles[i] }))
            .sort((a, b) => a.angle - b.angle);
        
        for (let i = 0; i < sorted.length; i++) {
            const j = (i + 1) % sorted.length;
            const s1 = sorted[i].seg;
            const s2 = sorted[j].seg;
            const d1 = dirs[segs.indexOf(s1)];
            const d2 = dirs[segs.indexOf(s2)];
            
            const miter = calcMiter(p, d1, d2, halfW);
            if (miter) {
                if (!map[pIdx]) map[pIdx] = {};
                if (!map[pIdx][s1]) map[pIdx][s1] = {};
                if (!map[pIdx][s2]) map[pIdx][s2] = {};
                map[pIdx][s1].right = miter;  // s1's right side connects to miter
                map[pIdx][s2].left = miter;   // s2's left side connects to miter
            }
        }
    });
    
    return map;
}

// ============================================================================
// 3D TUNNEL CREATION WITH MITERED ENDS
// ============================================================================

/**
 * Create perpendicular vector (90 deg CCW)
 */
function perp(v) {
    return { x: -v.y, y: v.x };
}

function v2Add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function v2Scale(v, s) { return { x: v.x * s, y: v.y * s }; }

/**
 * Create a mitered tunnel for one segment
 */
function createTunnel(sketch, segIdx, hw, height, miterMap) {
    const s = sketch.segments[segIdx];
    const p1 = sketch.points[s.start];
    const p2 = sketch.points[s.end];
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return null;
    
    const dir = { x: dx / len, y: dy / len };
    const left = perp(dir);  // 90 CCW
    const right = perp(left); // 90 CW (or -90 CCW)
    const halfW = hw / 2;
    
    // Check if endpoints are intersections
    const startSegs = getSegmentsAtPoint(sketch, s.start);
    const endSegs = getSegmentsAtPoint(sketch, s.end);
    const isStartIntersect = startSegs.length > 1;
    const isEndIntersect = endSegs.length > 1;
    
    // Get miter points for this segment's ends
    const startMiter = isStartIntersect && miterMap[s.start] ? miterMap[s.start][segIdx] : null;
    const endMiter = isEndIntersect && miterMap[s.end] ? miterMap[s.end][segIdx] : null;
    
    // Offset points
    const offsetL = v2Scale(left, halfW);
    const offsetR = v2Scale(right, halfW);
    
    // Start side offset points
    let sl, sr; // start-left, start-right
    if (isStartIntersect && startMiter) {
        sl = startMiter.left || v2Add(p1, offsetL);
        sr = startMiter.right || v2Add(p1, offsetR);
    } else {
        sl = v2Add(p1, offsetL);
        sr = v2Add(p1, offsetR);
    }
    
    // End side offset points  
    let el, er; // end-left, end-right
    if (isEndIntersect && endMiter) {
        el = endMiter.left || v2Add(p2, offsetL);
        er = endMiter.right || v2Add(p2, offsetR);
    } else {
        el = v2Add(p2, offsetL);
        er = v2Add(p2, offsetR);
    }
    
    // Helper to create vertex
    const V = (x, y, z) => new CSG.Vertex([x, y, z], [0, 0, 1]);
    
    // Bottom and top vertices
    // Naming: s=start(p1), e=end(p2), l=left, r=right, b=bottom, t=top
    const sslb = V(sl.x, sl.y, 0);   // Start-Left-Bottom
    const ssrb = V(sr.x, sr.y, 0);   // Start-Right-Bottom
    const selb = V(el.x, el.y, 0);   // End-Left-Bottom
    const serb = V(er.x, er.y, 0);   // End-Right-Bottom
    const sslt = V(sl.x, sl.y, height); // Start-Left-Top
    const ssrt = V(sr.x, sr.y, height); // Start-Right-Top
    const selft = V(el.x, el.y, height); // End-Left-Top
    const sert = V(er.x, er.y, height);  // End-Right-Top
    
    // 6 faces with correct CCW winding when viewed from OUTSIDE the tunnel
    // Bottom face (z=0), normal points down (0,0,-1):
    // CCW from below: sslb -> ssrb -> serb -> selb
    const bottom = new CSG.Polygon([sslb, ssrb, serb, selb], null);
    
    // Top face (z=height), normal points up (0,0,1):
    // CCW from above: sslt -> selft -> sert -> ssrt
    const top = new CSG.Polygon([sslt, selft, sert, ssrt], null);
    
    // Back face (at start), normal points opposite to dir:
    // CCW from back: sslb -> sslt -> ssrt -> ssrb
    const back = new CSG.Polygon([sslb, sslt, ssrt, ssrb], null);
    
    // Front face (at end), normal points same as dir:
    // CCW from front: selb -> selft -> sert -> serb
    const front = new CSG.Polygon([selb, selft, sert, serb], null);
    
    // Left face, normal points in direction of left perpendicular:
    // CCW from left: sslb -> sslt -> selft -> selb
    const left = new CSG.Polygon([sslb, sslt, selft, selb], null);
    
    // Right face, normal points opposite to left perpendicular:
    // CCW from right: ssrb -> ssrt -> sert -> serb
    const right = new CSG.Polygon([ssrb, ssrt, sert, serb], null);
    
    return CSG.fromPolygons([bottom, top, back, front, left, right]);
}

function createBaseCube(sketch, height, padding) {
    const bbox = computeBoundingBoxWithMargin(sketch, padding);
    const w = bbox.maxX - bbox.minX;
    const d = bbox.maxY - bbox.minY;
    
    if (w <= 0 || d <= 0 || height <= 0) {
        return createCSGCube(0, 0, height / 2, 10, 10, height);
    }
    
    return createCSGCube(
        (bbox.minX + bbox.maxX) / 2,
        (bbox.minY + bbox.maxY) / 2,
        height / 2,
        w, d, height
    );
}

function generateCSGModel(sketch, extrusionHeight, hallwayWidth) {
    const padding = hallwayWidth * 2;
    let base = createBaseCube(sketch, extrusionHeight, padding);
    
    // Calculate all miter points first
    const miterMap = calcAllMiters(sketch, hallwayWidth);
    
    // Create and subtract tunnels
    sketch.segments.forEach((s, idx) => {
        const tunnel = createTunnel(sketch, idx, hallwayWidth, extrusionHeight, miterMap);
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
