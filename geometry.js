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

function createCSGCube(centerX, centerY, centerZ, width, depth, height) {
    return CSG.cube({ center: [centerX, centerY, centerZ], radius: [width / 2, depth / 2, height / 2] });
}

function createBaseCube(sketch, height, padding) {
    const bbox = computeBoundingBoxWithMargin(sketch, padding);
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
 * Extrudes a clean 2D polygon into a 3D CSG solid
 */
function createExtrudedPrism(points2D, zMin, zMax) {
    if (points2D.length < 3) return null;
    let pts = points2D;
    if (signedArea2D(pts) < 0) pts = pts.slice().reverse();

    const polygons = [];
    const n = pts.length;
    const bottomVerts = pts.map(p => new CSG.Vertex([p.x, p.y, zMin], [0, 0, -1]));
    const topVerts = pts.map(p => new CSG.Vertex([p.x, p.y, zMax], [0, 0, 1]));

    polygons.push(new CSG.Polygon(bottomVerts.slice().reverse()));
    polygons.push(new CSG.Polygon(topVerts));

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
 * Create an extruded prism from polygon vertices
 * Creates a solid prism that can be subtracted from the base
 * Normals point outward from the prism for proper CSG operations
 */
function createPolygonPrism(vertices2D, zMin, zMax) {
    if (vertices2D.length < 3) return null;
    
    // Ensure vertices are in counter-clockwise order (positive area)
    let pts = vertices2D;
    if (signedArea2D(pts) < 0) pts = pts.slice().reverse();
    
    const polygons = [];
    const n = pts.length;
    
    // Bottom face - normal pointing down (outward from prism)
    const bottomVerts = pts.map(p => new CSG.Vertex([p.x, p.y, zMin], [0, 0, -1]));
    polygons.push(new CSG.Polygon(bottomVerts.slice().reverse()));
    
    // Top face - normal pointing up (outward from prism)
    const topVerts = pts.map(p => new CSG.Vertex([p.x, p.y, zMax], [0, 0, 1]));
    polygons.push(new CSG.Polygon(topVerts));
    
    // Side faces - normals pointing outward from the prism
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p1 = pts[i], p2 = pts[j];
        const ex = p2.x - p1.x, ey = p2.y - p1.y, len = Math.hypot(ex, ey) || 1;
        // Normal pointing outward (perpendicular to edge, pointing away from polygon center)
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
 * Compute bounding box that includes all points from sketch
 */
function computeBoundingBoxWithPolygons(sketch, margin) {
    // This is the same as computeBoundingBoxWithMargin since polygons use same points
    return computeBoundingBoxWithMargin(sketch, margin);
}

/**
 * Computes all junction shapes and segment end-cap connectors cleanly
 */
function generateCSGModel(sketch, extrusionHeight, hallwayWidth, miterLimit = 4) {
    const r = hallwayWidth / 2;
    const maxMiterDist = hallwayWidth * miterLimit;
    const { arms, positionGroups } = buildJunctionArms(sketch);
    
    // Create base cube that encloses all segments and polygons
    // Use hallwayWidth * 2 as padding - this will be added to the actual bounding box
    const basePadding = hallwayWidth * 2;
    let base = createBaseCube(sketch, extrusionHeight, basePadding);

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
                const polyVertices = poly.vertices.map(vIdx => sketch.points[vIdx]);
                
                // Create a prism for the polygon and subtract it from the base
                const polyVolume = createPolygonPrism(polyVertices, 0, extrusionHeight);
                if (polyVolume) {
                    base = base.subtract(polyVolume);
                }
            }
        });
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
        createCSGCube,
        createBaseCube,
        createExtrudedPrism,
        createPolygonPrism
    };
}