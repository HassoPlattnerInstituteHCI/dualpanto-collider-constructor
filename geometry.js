// geometry.js - CSG-Based 3D Extrusion with Perfect Junctions

function computeBoundingBoxWithMargin(sketch, margin) {
    if (sketch.points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    sketch.points.forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
}

/**
 * Compute bounding box from a specific set of point indices
 */
function computeBoundingBoxFromPoints(points, margin) {
    if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
}

/**
 * Compute bounding box excluding points that are only used by obstacles
 * This ensures obstacles retain their shape when not inside rooms
 */
function computeBaseBoundingBox(sketch, margin) {
    // Collect all point indices used by non-obstacle geometry
    const nonObstaclePointIndices = new Set();
    
    // Add segment endpoints
    sketch.segments.forEach(seg => {
        nonObstaclePointIndices.add(seg.start);
        nonObstaclePointIndices.add(seg.end);
    });
    
    // Add polygon vertices
    if (sketch.polygons) {
        sketch.polygons.forEach(poly => {
            poly.vertices.forEach(vIdx => nonObstaclePointIndices.add(vIdx));
        });
    }
    
    // If we have non-obstacle points, use only those
    if (nonObstaclePointIndices.size > 0) {
        const nonObstaclePoints = sketch.points.filter((_, idx) => nonObstaclePointIndices.has(idx));
        if (nonObstaclePoints.length > 0) {
            return computeBoundingBoxFromPoints(nonObstaclePoints, margin);
        }
    }
    
    // No non-obstacle points (no segments, no polygons)
    // Return a minimal bounding box at origin - this case is handled in generateCSGModel
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

/**
 * Check if a polygon is convex
 * A polygon is convex if all its interior angles are <= 180 degrees,
 * which means all cross products of consecutive edges have the same sign.
 */
function isConvex(polygon) {
    const n = polygon.length;
    if (n < 3) return true;
    
    // Find the first non-zero cross product to determine the expected sign
    let expectedSign = 0;
    for (let i = 0; i < n; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % n];
        const p3 = polygon[(i + 2) % n];
        
        // Vector from p1 to p2
        const dx1 = p2.x - p1.x;
        const dy1 = p2.y - p1.y;
        
        // Vector from p2 to p3
        const dx2 = p3.x - p2.x;
        const dy2 = p3.y - p2.y;
        
        // Cross product: dx1 * dy2 - dy1 * dx2
        const cross = dx1 * dy2 - dy1 * dx2;
        
        if (cross !== 0) {
            expectedSign = cross > 0 ? 1 : -1;
            break;
        }
    }
    
    // If all cross products are zero, the polygon is degenerate (all colinear)
    if (expectedSign === 0) return true;
    
    // Check all cross products have the same sign
    for (let i = 0; i < n; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % n];
        const p3 = polygon[(i + 2) % n];
        
        const dx1 = p2.x - p1.x;
        const dy1 = p2.y - p1.y;
        const dx2 = p3.x - p2.x;
        const dy2 = p3.y - p2.y;
        
        const cross = dx1 * dy2 - dy1 * dx2;
        
        // Skip zero cross products (colinear points)
        if (cross !== 0) {
            const currentSign = cross > 0 ? 1 : -1;
            if (currentSign !== expectedSign) {
                return false; // Found a different sign - concave
            }
        }
    }
    
    return true; // All non-zero cross products have the same sign - convex
}

/**
 * Triangulate a polygon into multiple triangles using ear clipping.
 * Works for both convex and concave simple polygons.
 * Returns an array of triangle vertex arrays [[v1, v2, v3], [v4, v5, v6], ...]
 */
function triangulatePolygon(vertices2D) {
    const n = vertices2D.length;
    if (n < 3) return [];
    
    // Ensure counter-clockwise winding
    let pts = vertices2D;
    if (signedArea2D(pts) < 0) {
        pts = pts.slice().reverse();
    }
    
    // For triangles, just return the single triangle
    if (n === 3) {
        return [pts.slice()];
    }
    
    // For convex polygons, simple fan triangulation works perfectly
    if (isConvex(pts)) {
        const triangles = [];
        const v0 = pts[0];
        for (let i = 1; i < n - 1; i++) {
            triangles.push([v0, pts[i], pts[i + 1]]);
        }
        return triangles;
    }
    
    // Ear clipping for concave polygons
    const triangles = [];
    
    // Work with indices to track which vertices are still active
    const vertices = pts.slice();
    const next = new Array(n);
    const prev = new Array(n);
    const active = new Array(n).fill(true);
    
    // Initialize circular doubly-linked list
    for (let i = 0; i < n; i++) {
        next[i] = (i + 1) % n;
        prev[i] = (i - 1 + n) % n;
    }
    
    let remainingCount = n;
    
    // Helper: check if vertex i is an ear
    const isEar = (i) => {
        const a = prev[i];
        const b = i;
        const c = next[i];
        
        // Check convexity using cross product
        // For CCW polygon, cross > 0 means convex
        const cross = (vertices[c].x - vertices[b].x) * (vertices[a].y - vertices[b].y) -
                      (vertices[c].y - vertices[b].y) * (vertices[a].x - vertices[b].x);
        if (cross <= 0) return false; // Reflex or collinear
        
        // Check that no other vertex lies inside triangle (a, b, c)
        for (let j = 0; j < n; j++) {
            if (!active[j] || j === a || j === b || j === c) continue;
            
            // Check if point j is inside triangle abc using barycentric coordinates
            const v = vertices[j];
            const d00 = (vertices[b].x - vertices[a].x) * (vertices[c].y - vertices[a].y) -
                         (vertices[b].y - vertices[a].y) * (vertices[c].x - vertices[a].x);
            if (Math.abs(d00) < 1e-12) continue; // Degenerate triangle
            
            const d11 = (vertices[b].x - v.x) * (vertices[c].y - v.y) -
                         (vertices[b].y - v.y) * (vertices[c].x - v.x);
            const d22 = (v.x - vertices[a].x) * (vertices[c].y - vertices[a].y) -
                         (v.y - vertices[a].y) * (vertices[c].x - vertices[a].x);
            
            const uu = d11 / d00;
            const vv = d22 / d00;
            
            if (uu >= -1e-10 && vv >= -1e-10 && uu + vv <= 1 + 1e-10) {
                return false;
            }
        }
        
        // Check diagonal a->c doesn't intersect any edges
        const aIndex = a;
        const cIndex = c;
        
        // Iterate through all edges
        for (let j = 0; j < n; j++) {
            if (!active[j] || !active[next[j]]) continue;
            
            // Skip edges connected to the triangle
            if (j === aIndex || j === cIndex || next[j] === aIndex || next[j] === cIndex) continue;
            
            // Check if diagonal (a, c) intersects edge (j, next[j])
            if (segmentsIntersect(vertices[aIndex], vertices[cIndex], vertices[j], vertices[next[j]])) {
                return false;
            }
        }
        
        return true;
    };
    
    // Helper: check if two segments intersect
    const segmentsIntersect = (a, b, c, d) => {
        // CCW test
        const ccw = (p1, p2, p3) => {
            return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
        };
        
        const ccw1 = ccw(a, b, c);
        const ccw2 = ccw(a, b, d);
        const ccw3 = ccw(c, d, a);
        const ccw4 = ccw(c, d, b);
        
        // Proper intersection (straddling)
        if (((ccw1 > 0 && ccw2 < 0) || (ccw1 < 0 && ccw2 > 0)) &&
            ((ccw3 > 0 && ccw4 < 0) || (ccw3 < 0 && ccw4 > 0))) {
            return true;
        }
        
        // Check for collinear cases or shared endpoints
        // For our purposes, we don't consider shared endpoints as intersections
        return false;
    };
    
    // Main ear clipping loop
    while (remainingCount > 3) {
        let foundEar = false;
        
        for (let i = 0; i < n; i++) {
            if (!active[i] || !isEar(i)) continue;
            
            // Found an ear - clip it
            const a = prev[i];
            const c = next[i];
            
            triangles.push([vertices[a], vertices[i], vertices[c]]);
            
            // Remove vertex i from the polygon
            active[i] = false;
            next[a] = c;
            prev[c] = a;
            remainingCount--;
            foundEar = true;
            break; // Restart the search after modification
        }
        
        if (!foundEar) {
            // No ear found - polygon is non-simple or has floating point issues
            // Fall back to fan triangulation
            const fanTriangles = [];
            let start = 0;
            while (start < n && !active[start]) start++;
            if (start >= n) break;
            
            for (let i = 1; i < remainingCount - 1; i++) {
                let current = next[start];
                for (let step = 0; step < i; step++) {
                    current = next[current];
                    while (!active[current]) current = next[current];
                }
                let nextCurrent = next[current];
                while (!active[nextCurrent]) nextCurrent = next[nextCurrent];
                fanTriangles.push([vertices[start], vertices[current], vertices[nextCurrent]]);
            }
            return fanTriangles.length > 0 ? fanTriangles : triangles;
        }
    }
    
    // Add the final triangle
    if (remainingCount === 3) {
        let start = 0;
        while (start < n && !active[start]) start++;
        if (start < n) {
            const triangle = [
                vertices[start],
                vertices[next[start]],
                vertices[next[next[start]]]
            ];
            triangles.push(triangle);
        }
    }
    
    return triangles;
}

function createCSGCube(centerX, centerY, centerZ, width, depth, height) {
    return CSG.cube({ center: [centerX, centerY, centerZ], radius: [width / 2, depth / 2, height / 2] });
}

function createBaseCube(sketch, height, padding) {
    const bbox = computeBaseBoundingBox(sketch, padding);
    return createCSGCube((bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2, height / 2, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, height);
}

// Vector Helpers
function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function vScale(a, s) { return { x: a.x * s, y: a.y * s }; }
function vLen(a) { return Math.hypot(a.x, a.y); }
function vLeftNormal(d) { return { x: -d.y, y: d.x }; }

function lineIntersect2D(A, dirA, B, dirB, eps = 1e-9) {
    const denom = dirA.x * dirB.y - dirA.y * dirB.x;
    if (Math.abs(denom) < eps) return null;
    return { x: A.x + dirA.x * ((B.x - A.x) * dirB.y - (B.y - A.y) * dirB.x) / denom, y: A.y + dirA.y * ((B.x - A.x) * dirB.y - (B.y - A.y) * dirB.x) / denom };
}

function signedArea2D(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i], p2 = points[(i + 1) % points.length];
        area += p1.x * p2.y - p2.x * p1.y;
    }
    return area / 2;
}

function groupVerticesByPosition(sketch) {
    const positionGroups = new Map(); // key: stringified coords -> array of point indices
    
    sketch.points.forEach((point, index) => {
        // Use toFixed for consistent string representation with same precision as move tool
        const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
        if (!positionGroups.has(key)) {
            positionGroups.set(key, []);
        }
        positionGroups.get(key).push(index);
    });
    
    return positionGroups;
}

function buildJunctionArms(sketch) {
    const positionGroups = groupVerticesByPosition(sketch);
    const pointToPosition = new Map(); // point index -> position key
    
    // Map each point to its position group
    sketch.points.forEach((point, index) => {
        const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
        pointToPosition.set(index, key);
    });
    
    // Build arms map: position key -> array of arms
    const arms = new Map();
    
    // Initialize all positions
    positionGroups.forEach((pointIndices, positionKey) => {
        arms.set(positionKey, []);
    });
    
    // Populate arms by processing segments
    sketch.segments.forEach((seg, segIndex) => {
        const p1 = sketch.points[seg.start], p2 = sketch.points[seg.end];
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
        if (len < 0.001) return;
        
        const dStart = { x: dx / len, y: dy / len };
        const dEnd = { x: -dx / len, y: -dy / len };
        
        const startKey = pointToPosition.get(seg.start);
        const endKey = pointToPosition.get(seg.end);
        
        // Add arm to start position
        arms.get(startKey).push({ 
            segIndex, 
            dir: dStart, 
            angle: Math.atan2(dStart.y, dStart.x), 
            isStart: true,
            pointIndices: positionGroups.get(startKey) // all points at this position
        });
        
        // Add arm to end position
        arms.get(endKey).push({ 
            segIndex, 
            dir: dEnd, 
            angle: Math.atan2(dEnd.y, dEnd.x), 
            isStart: false,
            pointIndices: positionGroups.get(endKey) // all points at this position
        });
    });
    
    // Sort arms by angle for proper junction ordering
    arms.forEach(list => list.sort((a, b) => a.angle - b.angle));
    
    return { arms, positionGroups, pointToPosition };
}

/**
 * Creates an extruded prism from 2D polygon vertices.
 * Extrudes a clean 2D polygon into a 3D CSG solid with proper outward normals.
 * Handles both CONVEX and CONCAVE polygons by explicitly triangulating top and bottom faces.
 */
function createExtrudedPrism(points2D, zMin, zMax) {
    if (points2D.length < 3) return null;
    
    // Ensure counter-clockwise winding
    let pts = points2D;
    if (signedArea2D(pts) < 0) pts = pts.slice().reverse();

    const polygons = [];
    const n = pts.length;

    // Triangulate top and bottom faces to handle concave polygons correctly
    const triangles = triangulatePolygon(pts);

    // Bottom triangles (reverse winding for downward normal [0,0,-1])
    triangles.forEach(tri => {
        polygons.push(new CSG.Polygon([
            new CSG.Vertex([tri[2].x, tri[2].y, zMin], [0, 0, -1]),
            new CSG.Vertex([tri[1].x, tri[1].y, zMin], [0, 0, -1]),
            new CSG.Vertex([tri[0].x, tri[0].y, zMin], [0, 0, -1])
        ]));
    });

    // Top triangles (CCW winding for upward normal [0,0,1])
    triangles.forEach(tri => {
        polygons.push(new CSG.Polygon([
            new CSG.Vertex([tri[0].x, tri[0].y, zMax], [0, 0, 1]),
            new CSG.Vertex([tri[1].x, tri[1].y, zMax], [0, 0, 1]),
            new CSG.Vertex([tri[2].x, tri[2].y, zMax], [0, 0, 1])
        ]));
    });

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p1 = pts[i], p2 = pts[j];
        const ex = p2.x - p1.x, ey = p2.y - p1.y, len = Math.hypot(ex, ey) || 1;
        const nx = ey / len, ny = -ex / len;

        polygons.push(new CSG.Polygon([
            new CSG.Vertex([p1.x, p1.y, zMin], [nx, ny, 0]),
            new CSG.Vertex([p2.x, p2.y, zMin], [nx, ny, 0]),
            new CSG.Vertex([p2.x, p2.y, zMax], [nx, ny, 0]),
            new CSG.Vertex([p1.x, p1.y, zMax], [nx, ny, 0])
        ]));
    }
    
    return CSG.fromPolygons(polygons);
}

/**
 * Creates a complete, watertight triangular prism from 3 vertices.
 * Used as a building block for concave polygon extrusion.
 * @param {Array} triangle - Array of 3 vertices: [{x, y}, {x, y}, {x, y}]
 * @param {number} zMin - Minimum Z coordinate
 * @param {number} zMax - Maximum Z coordinate
 * @returns {CSG} CSG solid representing the triangular prism
 */
function createTriangularPrism(triangle, zMin, zMax) {
    // Ensure CCW winding
    if (signedArea2D(triangle) < 0) {
        triangle = [triangle[0], triangle[2], triangle[1]];
    }
    
    const [v0, v1, v2] = triangle;
    const polygons = [];
    
    // Bottom triangle (reverse winding for downward normal)
    polygons.push(new CSG.Polygon([
        new CSG.Vertex([v2.x, v2.y, zMin], [0, 0, -1]),
        new CSG.Vertex([v1.x, v1.y, zMin], [0, 0, -1]),
        new CSG.Vertex([v0.x, v0.y, zMin], [0, 0, -1])
    ]));
    
    // Top triangle (CCW winding for upward normal)
    polygons.push(new CSG.Polygon([
        new CSG.Vertex([v0.x, v0.y, zMax], [0, 0, 1]),
        new CSG.Vertex([v1.x, v1.y, zMax], [0, 0, 1]),
        new CSG.Vertex([v2.x, v2.y, zMax], [0, 0, 1])
    ]));
    
    // Three side walls (rectangles)
    createSideRect(polygons, v0, v1, zMin, zMax);
    createSideRect(polygons, v1, v2, zMin, zMax);
    createSideRect(polygons, v2, v0, zMin, zMax);
    
    return CSG.fromPolygons(polygons);
}

/**
 * Creates a rectangle polygon for a side wall between two points.
 * For CCW-wound polygons, computes the outward-pointing normal.
 * @param {Array} polygons - Array to push the side rectangle polygon to
 * @param {Object} p1 - First point {x, y}
 * @param {Object} p2 - Second point {x, y}
 * @param {number} zMin - Minimum Z
 * @param {number} zMax - Maximum Z
 */
function createSideRect(polygons, p1, p2, zMin, zMax) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    
    if (len < 1e-9) {
        // Degenerate edge, skip
        return;
    }
    
    // Outward normal for CCW polygon: 90 degrees clockwise from edge direction
    // Edge vector: (dx, dy)
    // Outward normal: (dy, -dx) normalized
    const nx = dy / len;
    const ny = -dx / len;
    
    polygons.push(new CSG.Polygon([
        new CSG.Vertex([p1.x, p1.y, zMin], [nx, ny, 0]),
        new CSG.Vertex([p2.x, p2.y, zMin], [nx, ny, 0]),
        new CSG.Vertex([p2.x, p2.y, zMax], [nx, ny, 0]),
        new CSG.Vertex([p1.x, p1.y, zMax], [nx, ny, 0])
    ]));
}

/**
 * Creates an extruded prism from a 2D polygon (convex or concave).
 * Alias for createExtrudedPrism - kept for backward compatibility.
 * @param {Array} points2D - Array of polygon vertices [{x, y}, ...]
 * @param {number} zMin - Minimum Z coordinate
 * @param {number} zMax - Maximum Z coordinate
 * @returns {CSG} CSG solid representing the extruded prism
 */
function createConcavePrism(points2D, zMin, zMax) {
    return createExtrudedPrism(points2D, zMin, zMax);
}

/**
 * Offset polygon vertices outwards by a given distance, keeping edges parallel.
 * Each edge is moved outward such that the new edge is parallel to the original
 * with a distance of offsetDistance between them.
 * Works for both CW and CCW vertex orders.
 */
function offsetPolygonOutwards(vertices, offsetDistance) {
    if (vertices.length < 3) return vertices.slice();
    
    // Determine if vertices are CW or CCW
    const area = signedArea2D(vertices);
    const isCCW = area > 0;
    
    const n = vertices.length;
    const offsetVerts = [];
    
    for (let i = 0; i < n; i++) {
        const currIdx = i;
        const nextIdx = (i + 1) % n;
        
        const v1 = vertices[currIdx];
        const v2 = vertices[nextIdx];
        
        // Edge vector from v1 to v2
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const edgeLen = Math.hypot(dx, dy);
        
        if (edgeLen < 1e-9) {
            // Degenerate edge, just offset the point
            offsetVerts.push({ x: v1.x + offsetDistance, y: v1.y });
            continue;
        }
        
        // Normal vector (90 degree rotation of edge vector)
        // For CCW: outward normal = (dy, -dx)
        // For CW: outward normal = (-dy, dx)
        const sign = isCCW ? 1 : -1;
        const nx = sign * dy / edgeLen;
        const ny = sign * -dx / edgeLen;
        
        // Point on the offset line for this edge
        const offsetPoint = { x: v1.x + nx * offsetDistance, y: v1.y + ny * offsetDistance };
        
        // Find intersection with previous edge's offset line
        const prevIdx = (i - 1 + n) % n;
        const v0 = vertices[prevIdx];
        
        const prevDx = v1.x - v0.x;
        const prevDy = v1.y - v0.y;
        const prevEdgeLen = Math.hypot(prevDx, prevDy);
        
        if (prevEdgeLen < 1e-9) {
            offsetVerts.push(offsetPoint);
            continue;
        }
        
        // Previous edge's outward normal (using same orientation)
        const prevNx = sign * prevDy / prevEdgeLen;
        const prevNy = sign * -prevDx / prevEdgeLen;
        
        // Point on previous edge's offset line
        const prevOffsetPoint = { x: v0.x + prevNx * offsetDistance, y: v0.y + prevNy * offsetDistance };
        
        const intersection = lineIntersect2D(
            offsetPoint, { x: dx, y: dy },
            prevOffsetPoint, { x: prevDx, y: prevDy }
        );
        
        if (intersection) {
            offsetVerts.push(intersection);
        } else {
            // Lines are parallel, use offset point
            offsetVerts.push(offsetPoint);
        }
    }
    
    return offsetVerts;
}

/**
 * Create an extruded prism from polygon vertices.
 * Creates a solid prism that can be subtracted from the base.
 * Normals point outward from the prism for proper CSG operations.
 * Same as createExtrudedPrism - kept as an alias for backward compatibility.
 */
function createPolygonPrism(vertices2D, zMin, zMax) {
    return createExtrudedPrism(vertices2D, zMin, zMax);
}

/**
 * Computes all junction shapes and segment end-cap connectors cleanly
 */
function generateCSGModel(sketch, extrusionHeight, hallwayWidth, miterLimit = 4) {
    const r = hallwayWidth / 2;
    const maxMiterDist = hallwayWidth * miterLimit;
    const { arms, positionGroups } = buildJunctionArms(sketch);
    
    // Check if there are any non-obstacle features (segments or polygons)
    const hasSegments = sketch.segments && sketch.segments.length > 0;
    const hasPolygons = sketch.polygons && sketch.polygons.length > 0;
    const hasNonObstacleFeatures = hasSegments || hasPolygons;
    
    // Create base cube that encloses all segments and polygons
    // Use hallwayWidth * 2 as padding - this will be added to the actual bounding box
    const basePadding = hallwayWidth * 5;
    let base = hasNonObstacleFeatures ? createBaseCube(sketch, extrusionHeight, basePadding) : null;

    // Maps to store the clean transition line for each segment end
    // key: segIndex -> { startLeft, startRight, endLeft, endRight }
    const segCaps = new Map();
    sketch.segments.forEach((_, idx) => segCaps.set(idx, {}));

    // 1. Generate Junction Rooms and map out segment connection lines
    arms.forEach((armList, positionKey) => {
        // Get a representative point for this position
        const pointIndices = positionGroups.get(positionKey);
        const point = sketch.points[pointIndices[0]];
        const n = armList.length;
        if (n === 0) return;

        if (n === 1) {
            // Dead end: Create flat cap reference points
            const arm = armList[0];
            const nrm = vLeftNormal(arm.dir);
            const leftPt = vAdd(point, vScale(nrm, r));
            const rightPt = vSub(point, vScale(nrm, r));
            
            // Apply cap to all segments that end at this position
            armList.forEach(arm => {
                const cap = segCaps.get(arm.segIndex);
                if (arm.isStart) { cap.startLeft = leftPt; cap.startRight = rightPt; }
                else { cap.endLeft = rightPt; cap.endRight = leftPt; }
            });
            return;
        }

        // Multi-line junction (2 or more arms): Calculate cyclic wall intersection points
        const junctionVertices = [];
        const gapCorners = new Array(n);

        for (let i = 0; i < n; i++) {
            const armA = armList[i];
            const armB = armList[(i + 1) % n];
            
            const nA = vLeftNormal(armA.dir);
            const nB = vLeftNormal(armB.dir);

            const lineAOrigin = vAdd(point, vScale(nA, r));
            const lineBOrigin = vSub(point, vScale(nB, r));

            let corner = lineIntersect2D(lineAOrigin, armA.dir, lineBOrigin, armB.dir);
            if (!corner || vLen(vSub(corner, point)) > maxMiterDist) {
                corner = lineAOrigin; // Fallback
            }
            
            gapCorners[i] = corner;
            junctionVertices.push(corner);
        }

        // Carve out the unified Junction Room polygon
        const junctionVolume = createExtrudedPrism(junctionVertices, 0, extrusionHeight);
        if (junctionVolume) {
            base = base.subtract(junctionVolume);
        }

        // Assign corners to their respective matching segment ends
        for (let i = 0; i < n; i++) {
            const arm = armList[i];
            const prevIdx = (i - 1 + n) % n;
            
            const leftPt = gapCorners[i];
            const rightPt = gapCorners[prevIdx];

            const cap = segCaps.get(arm.segIndex);
            if (arm.isStart) { cap.startLeft = leftPt; cap.startRight = rightPt; }
            else { cap.endLeft = rightPt; cap.endRight = leftPt; }
        }
    });

    // 2. Carve out the perfectly straight, constant-width Hallway Trunks
    sketch.segments.forEach((_, segIndex) => {
        const caps = segCaps.get(segIndex);
        if (!caps.startLeft || !caps.endLeft) return;

        // A perfect 4-point convex rectangle spanning between junction rooms
        const trunkPoints = [caps.startRight, caps.endRight, caps.endLeft, caps.startLeft];
        const trunkVolume = createExtrudedPrism(trunkPoints, 0, extrusionHeight);
        if (trunkVolume) {
            base = base.subtract(trunkVolume);
        }
    });

    // 3. Carve out polygon cutouts
    if (sketch.polygons) {
        sketch.polygons.forEach(poly => {
            if (poly.vertices.length >= 3) {
                // Get the vertices for this polygon
                let polyVertices = poly.vertices.map(vIdx => sketch.points[vIdx]);
                
                // Enlarge polygon by moving each vertex outwards by half of hallway width
                polyVertices = offsetPolygonOutwards(polyVertices, r);
                
                // createPolygonPrism works for both convex and concave polygons
                const polyVolume = createPolygonPrism(polyVertices, 0, extrusionHeight);
                if (polyVolume) {
                    base = base.subtract(polyVolume);
                }
            }
        });
    }
    
    // 4. Add obstacle volumes (material to keep within rooms)
    // Obstacles are united with the base, so material remains solid in obstacle areas
    if (sketch.obstacles) {
        sketch.obstacles.forEach(obstacle => {
            if (obstacle.vertices.length >= 3) {
                // Get the vertices for this obstacle
                let obstacleVertices = obstacle.vertices.map(vIdx => sketch.points[vIdx]);
                
                // createPolygonPrism works for both convex and concave polygons
                const obstacleVolume = createPolygonPrism(obstacleVertices, 0, extrusionHeight);
                if (obstacleVolume) {
                    if (base) {
                        // Union: keep material in obstacle areas
                        base = base.union(obstacleVolume);
                    } else {
                        // No base (no segments/polygons), so start with this obstacle
                        base = obstacleVolume;
                    }
                }
            }
        });
    }

    // If base is still null (no segments, polygons, or obstacles), return empty CSG
    if (!base) {
        // Return an empty CSG solid
        base = CSG.fromPolygons([]);
    }
    
    return base;
}

function generateOBJFromSketch(sketch, extrusionHeight, hallwayWidth, miterLimit = 4) {
    const csgModel = generateCSGModel(sketch, extrusionHeight, hallwayWidth, miterLimit);
    return csgToOBJ(csgModel);
}

// Export functions for Node.js testing while maintaining browser compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        groupVerticesByPosition,
        buildJunctionArms,
        generateCSGModel,
        generateOBJFromSketch,
        computeBoundingBoxWithMargin,
        computeBoundingBoxFromPoints,
        computeBaseBoundingBox,
        createCSGCube,
        createBaseCube,
        createExtrudedPrism,
        createPolygonPrism,
        createTriangularPrism,
        createSideRect,
        createConcavePrism,
        offsetPolygonOutwards,
        isConvex,
        triangulatePolygon
    };
}