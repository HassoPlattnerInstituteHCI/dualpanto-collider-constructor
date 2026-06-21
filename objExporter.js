// objExporter.js - OBJ File Export Logic

/**
 * Apply -90 degree rotation around X axis AND mirror along Z axis to a vertex
 * This matches Unity's expected coordinate system
 * 
 * Transformations applied:
 * 1. Mirror along Z: (x, y, z) -> (x, y, -z)
 * 2. Rotate -90° around X: (x, y, z) -> (x, z, -y)
 * 
 * Combined: (x, y, z) -> (x, -z, -y)
 */
function transformForUnity(v) {
    return {
        x: -v.x,
        y: v.z,  // mirror Z then rotate
        z: -v.y   // from rotation
    };
}

/**
 * Convert CSG model to OBJ format string
 * @param {CSG} csg - CSG solid to export
 * @returns {string} OBJ format text
 */
function csgToOBJ(csg) {
    const polygons = csg.toPolygons();
    
    if (polygons.length === 0) {
        return '# Empty model\n';
    }
    
    const vertices = [];
    const faces = [];
    const vertexMap = new Map(); // Maps vertex coordinates to index
    
    // First pass: collect all unique vertices and apply rotation
    const allVertices = [];
    polygons.forEach(polygon => {
        polygon.vertices.forEach(v => {
            allVertices.push(v.pos);
        });
    });
    
    // Create vertex map with deduplication and transformation
    allVertices.forEach((pos, i) => {
        // Apply Unity coordinate transformation
        const transformedPos = transformForUnity(pos);
        const key = `${transformedPos.x.toFixed(6)},${transformedPos.y.toFixed(6)},${transformedPos.z.toFixed(6)}`;
        if (!vertexMap.has(key)) {
            vertexMap.set(key, vertices.length + 1); // OBJ indices start at 1
            vertices.push(transformedPos);
        }
    });
    
    // Second pass: create faces (using transformed positions for lookup)
    // Note: Mirror transformations reverse polygon winding order.
    // Reverse face vertex order to maintain correct winding after transform.
    polygons.forEach(polygon => {
        const faceIndices = polygon.vertices.map(v => {
            // Apply same transformation to get the key
            const transformedPos = transformForUnity(v.pos);
            const key = `${transformedPos.x.toFixed(6)},${transformedPos.y.toFixed(6)},${transformedPos.z.toFixed(6)}`;
            return vertexMap.get(key);
        });
        // Reverse vertex order to fix winding after mirroring
        faces.push(faceIndices.reverse());
    });
    
    // Build OBJ string
    let obj = '# Maze Extrusion Tool - Generated OBJ\n';
    obj += `# Date: ${new Date().toISOString()}\n`;
    obj += `# Vertices: ${vertices.length}\n`;
    obj += `# Faces: ${faces.length}\n\n`;
    
    // Vertices
    vertices.forEach(v => {
        obj += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    });
    
    obj += '\n';
    
    // Faces
    faces.forEach(face => {
        obj += `f ${face.join(' ')}\n`;
    });
    
    return obj;
}

/**
 * Download OBJ file
 * @param {string} objString - OBJ content
 * @param {string} filename - Output filename
 */
function downloadOBJ(objString, filename) {
    const blob = new Blob([objString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `maze.obj`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
