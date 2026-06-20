// geometry.js - Simple 3D Extrusion with Rectangular Tunnels
// No miters initially - just get basic cutouts working

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

// Simple 2D vector helpers
function v2Add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function v2Scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function v2perp90(v) { return { x: -v.y, y: v.x }; } // 90 deg CCW

/**
 * Create a tunnel prism for a line segment
 * Uses direct vertex computation - no rotation/translation
 * Tunnel extends hallwayWidth/2 beyond each endpoint for clean intersections
 */
function createTunnelPrism(p1, p2, hallwayWidth, height) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    
    if (length < 0.001) return null;
    
    // Unit direction vector
    const dir = { x: dx / length, y: dy / length };
    // Perpendicular vectors
    const perpL = v2perp90(dir); // 90 CCW (left)
    const perpR = v2perp90(perpL); // 90 CW (right)
    
    const halfW = hallwayWidth / 2;
    const halfH = height / 2;
    const midZ = height / 2;
    
    // Tunnel length: extend beyond endpoints for clean intersections
    const tunnelLength = length + hallwayWidth;
    const halfL = tunnelLength / 2;
    
    // Center at midpoint
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    
    // Helper to create vertex
    const V = (x, y, z) => new CSG.Vertex([x, y, z], [0, 0, 1]);
    
    // Compute 8 vertices of the tunnel prism
    // Using local coordinates along the segment
    const vertices = [];
    for (const l of [-halfL, halfL]) {
        for (const w of [-halfW, halfW]) {
            for (const h of [-halfH, halfH]) {
                vertices.push(V(
                    midX + l * dir.x + w * perpL.x,
                    midY + l * dir.y + w * perpL.y,
                    midZ + h
                ));
            }
        }
    }
    
    // Map vertex indices: l, w, h -> index
    // l=-1: 0-3, l=+1: 4-7
    // w=-1: 0,2,4,6; w=+1: 1,3,5,7
    // h=-1: 0-3; h=+1: 4-7
    const v = (l, w, h) => vertices[(l+1)*4 + (w+1)*2 + (h+1)];
    
    // 6 faces with correct CCW winding
    const polygons = [
        // Bottom (h=-1)
        new CSG.Polygon([v(-1,-1,-1), v(-1,+1,-1), v(+1,+1,-1), v(+1,-1,-1)], null),
        // Top (h=+1)
        new CSG.Polygon([v(-1,-1,+1), v(+1,-1,+1), v(+1,+1,+1), v(-1,+1,+1)], null),
        // Back (l=-1)
        new CSG.Polygon([v(-1,-1,-1), v(-1,-1,+1), v(-1,+1,+1), v(-1,+1,-1)], null),
        // Front (l=+1)
        new CSG.Polygon([v(+1,-1,-1), v(+1,+1,-1), v(+1,+1,+1), v(+1,-1,+1)], null),
        // Left (w=-1)
        new CSG.Polygon([v(-1,-1,-1), v(-1,-1,+1), v(+1,-1,+1), v(+1,-1,-1)], null),
        // Right (w=+1)
        new CSG.Polygon([v(-1,+1,-1), v(+1,+1,-1), v(+1,+1,+1), v(-1,+1,+1)], null)
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
