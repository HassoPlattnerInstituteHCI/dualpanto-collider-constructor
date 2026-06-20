// geometry.js - CSG-Based 3D Extrusion
// Hallway cutouts follow segments exactly

/**
 * Compute bounding box with margin
 */
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

/**
 * Create a CSG cube (box) with given center and dimensions
 */
function createCSGCube(centerX, centerY, centerZ, width, depth, height) {
    return CSG.cube({
        center: [centerX, centerY, centerZ],
        radius: [width / 2, depth / 2, height / 2]
    });
}

/**
 * Rotate a CSG solid around Z axis by given angle (in degrees)
 */
function rotateCSGZ(csg, angleDegrees) {
    const angleRad = angleDegrees * Math.PI / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    
    const polygons = csg.toPolygons().map(polygon => {
        const newVertices = polygon.vertices.map(v => {
            const x = v.pos.x;
            const y = v.pos.y;
            const z = v.pos.z;
            
            const newX = x * cosA - y * sinA;
            const newY = x * sinA + y * cosA;
            
            const nx = v.normal.x;
            const ny = v.normal.y;
            const nz = v.normal.z;
            const newNx = nx * cosA - ny * sinA;
            const newNy = nx * sinA + ny * cosA;
            
            return new CSG.Vertex([newX, newY, z], [newNx, newNy, nz]);
        });
        
        return new CSG.Polygon(newVertices);
    });
    
    return CSG.fromPolygons(polygons);
}

/**
 * Translate a CSG solid by given offset
 */
function translateCSG(csg, offsetX, offsetY, offsetZ) {
    const polygons = csg.toPolygons().map(polygon => {
        const newVertices = polygon.vertices.map(v => {
            return new CSG.Vertex(
                [v.pos.x + offsetX, v.pos.y + offsetY, v.pos.z + offsetZ],
                v.normal.clone()
            );
        });
        return new CSG.Polygon(newVertices);
    });
    return CSG.fromPolygons(polygons);
}

/**
 * Create base cube for the sketch
 */
function createBaseCube(sketch, height, padding) {
    const bbox = computeBoundingBoxWithMargin(sketch, padding);
    const width = bbox.maxX - bbox.minX;
    const depth = bbox.maxY - bbox.minY;
    
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    const centerZ = height / 2;
    
    return createCSGCube(centerX, centerY, centerZ, width, depth, height);
}

/**
 * Create a tunnel prism for a line segment
 * The tunnel follows the segment exactly - same start and end points
 * Positioned at the segment, with length exactly matching the segment
 */
function createTunnelPrism(p1, p2, hallwayWidth, height) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    
    if (length < 0.001) return null;
    
    // Tunnel length is EXACTLY the segment length - no extension
    const tunnelLength = length;
    
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    
    const angleDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
    
    // Create tunnel centered at midpoint, then rotate to align with segment
    let tunnel = createCSGCube(midX, midY, height / 2, tunnelLength, hallwayWidth, height);
    
    // Translate to origin, rotate, translate back
    tunnel = translateCSG(tunnel, -midX, -midY, 0);
    tunnel = rotateCSGZ(tunnel, angleDegrees);
    tunnel = translateCSG(tunnel, midX, midY, 0);
    
    return tunnel;
}

/**
 * Generate CSG model from sketch
 */
function generateCSGModel(sketch, extrusionHeight, hallwayWidth) {
    const padding = hallwayWidth * 2;
    let base = createBaseCube(sketch, extrusionHeight, padding);
    
    sketch.segments.forEach(seg => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const tunnel = createTunnelPrism(p1, p2, hallwayWidth, extrusionHeight);
        if (tunnel) {
            base = base.subtract(tunnel);
        }
    });
    
    return base;
}

/**
 * Generate OBJ from sketch using CSG library
 */
function generateOBJFromSketch(sketch, extrusionHeight, hallwayWidth) {
    const csgModel = generateCSGModel(sketch, extrusionHeight, hallwayWidth);
    return csgToOBJ(csgModel);
}
