// objExporter.js - OBJ File Export Logic

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
    
    // First pass: collect all unique vertices
    const allVertices = [];
    polygons.forEach(polygon => {
        polygon.vertices.forEach(v => {
            allVertices.push(v.pos);
        });
    });
    
    // Create vertex map with deduplication
    allVertices.forEach((pos, i) => {
        const key = `${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`;
        if (!vertexMap.has(key)) {
            vertexMap.set(key, vertices.length + 1); // OBJ indices start at 1
            vertices.push({ x: pos.x, y: pos.y, z: pos.z });
        }
    });
    
    // Second pass: create faces
    polygons.forEach(polygon => {
        const faceIndices = polygon.vertices.map(v => {
            const key = `${v.pos.x.toFixed(6)},${v.pos.y.toFixed(6)},${v.pos.z.toFixed(6)}`;
            return vertexMap.get(key);
        });
        faces.push(faceIndices);
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
