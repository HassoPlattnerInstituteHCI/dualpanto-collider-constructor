// geometry.js - CSG-Based 3D Extrusion
// Direct tunnel creation without rotation/translation

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

/**
 * Create a tunnel prism directly as polygons for a line segment
 * This avoids rotation/translation issues by computing vertices directly
 */
function createTunnelPrism(p1, p2, hallwayWidth, height) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    
    if (length < 0.001) return null;
    
    // Unit direction vector along the segment
    const dirX = dx / length;
    const dirY = dy / length;
    
    // Unit perpendicular vector (90 degree rotation of direction vector)
    const perpX = -dirY;
    const perpY = dirX;
    
    // Half dimensions
    const halfW = hallwayWidth / 2;
    const halfH = height / 2;
    
    // Tunnel length: extend hallwayWidth/2 beyond each endpoint for clean intersections
    const tunnelLength = length + hallwayWidth;
    const halfL = tunnelLength / 2;
    
    // Center at midpoint, at height/2 (same as base cube)
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const midZ = height / 2;
    
    // Compute vertex positions
    const pos = (l, w, h) => [
        midX + l * dirX + w * perpX,
        midY + l * dirY + w * perpY,
        midZ + h
    ];
    
    // Create vertices with approximate normals (will be recalculated by CSG.Polygon)
    // Using simple axis-aligned normals as placeholders
    const v = (l, w, h, nx, ny, nz) => new CSG.Vertex(pos(l, w, h), [nx, ny, nz]);
    
    // 8 vertices: l ranges from -halfL to +halfL, w ranges from -halfW to +halfW, h ranges from -halfH to +halfH
    const v000 = v(-halfL, -halfW, -halfH,  0, 0, -1); // back-left-bottom
    const v100 = v( halfL, -halfW, -halfH,  0, 0, -1); // front-left-bottom
    const v110 = v( halfL,  halfW, -halfH,  0, 0, -1); // front-right-bottom
    const v010 = v(-halfL,  halfW, -halfH,  0, 0, -1); // back-right-bottom
    const v001 = v(-halfL, -halfW,  halfH,  0, 0, 1); // back-left-top
    const v101 = v( halfL, -halfW,  halfH,  0, 0, 1); // front-left-top
    const v111 = v( halfL,  halfW,  halfH,  0, 0, 1); // front-right-top
    const v011 = v(-halfL,  halfW,  halfH,  0, 0, 1); // back-right-top
    
    // 6 faces - vertices in counter-clockwise order when viewed from outside
    const polygons = [
        // Bottom face (z = -halfH) - looking up, CCW: back-left, front-left, front-right, back-right
        new CSG.Polygon([v000, v100, v110, v010], null),
        // Top face (z = +halfH) - looking down, CCW: back-left, back-right, front-right, front-left
        new CSG.Polygon([v001, v011, v111, v101], null),
        // Front face (along +dir) - looking back, CCW: front-left, front-right, front-right-top, front-left-top
        new CSG.Polygon([v100, v110, v111, v101], null),
        // Back face (along -dir) - looking front, CCW: back-left, back-left-top, back-right-top, back-right
        new CSG.Polygon([v000, v001, v011, v010], null),
        // Right face (along +perp) - looking left, CCW: front-right, back-right, back-right-top, front-right-top
        new CSG.Polygon([v110, v010, v011, v111], null),
        // Left face (along -perp) - looking right, CCW: front-left, front-left-top, back-left-top, back-left
        new CSG.Polygon([v100, v101, v001, v000], null)
    ];
    
    return CSG.fromPolygons(polygons);
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

function generateOBJFromSketch(sketch, extrusionHeight, hallwayWidth) {
    const csgModel = generateCSGModel(sketch, extrusionHeight, hallwayWidth);
    return csgToOBJ(csgModel);
}
