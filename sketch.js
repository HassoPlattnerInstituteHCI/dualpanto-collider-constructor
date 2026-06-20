// sketch.js - 2D Sketch Data and Drawing Logic

const GRID_SPACING = 1; // mm
const SNAP_RADIUS = 5; // pixels
const MAJOR_GRID_INTERVAL = 10; // mm

// Canvas reference (initialized on DOM load)
let canvas;
let ctx;

// Sketch data model
const sketch = {
    points: [],       // Array of {x: number, y: number} in mm
    segments: []      // Array of {start: index, end: index} referencing points
};

// Viewport state
const viewport = {
    offsetX: 0,    // mm at center of canvas
    offsetY: 0,    // mm at center of canvas
    scale: 2,      // pixels per mm
    panX: 0,       // panning offset in pixels
    panY: 0        // panning offset in pixels
};

// Drawing state
let isDrawing = false;
let previewPoint = null;
let startPointIndex = null;

// ============================================
// COORDINATE TRANSFORMATIONS
// ============================================

function pixelToMM(pixelX, pixelY) {
    const mmX = (pixelX - canvas.width / 2 + viewport.panX) / viewport.scale - viewport.offsetX;
    const mmY = (pixelY - canvas.height / 2 + viewport.panY) / viewport.scale - viewport.offsetY;
    return { x: mmX, y: mmY };
}

function mmToPixel(mmX, mmY) {
    const pixelX = (mmX + viewport.offsetX) * viewport.scale + canvas.width / 2 - viewport.panX;
    const pixelY = (mmY + viewport.offsetY) * viewport.scale + canvas.height / 2 - viewport.panY;
    return { x: pixelX, y: pixelY };
}

// ============================================
// SNAPPING HELPERS
// ============================================

function snapToGrid(mmX, mmY) {
    return { x: Math.round(mmX), y: Math.round(mmY) };
}

function findNearestPoint(mmX, mmY, maxDistanceMM) {
    let nearestIndex = -1;
    let nearestDist = Infinity;
    
    sketch.points.forEach((p, i) => {
        const dx = p.x - mmX;
        const dy = p.y - mmY;
        const dist = Math.hypot(dx, dy);
        if (dist < maxDistanceMM && dist < nearestDist) {
            nearestDist = dist;
            nearestIndex = i;
        }
    });
    
    return nearestIndex !== -1 ? nearestIndex : null;
}

function snapToExistingPoint(mmX, mmY) {
    const snapRadiusMM = SNAP_RADIUS / viewport.scale;
    const nearestIndex = findNearestPoint(mmX, mmY, snapRadiusMM);
    if (nearestIndex !== null) {
        return { x: sketch.points[nearestIndex].x, y: sketch.points[nearestIndex].y };
    }
    return snapToGrid(mmX, mmY);
}

// ============================================
// SKETCH OPERATIONS
// ============================================

function clearSketch() {
    sketch.points = [];
    sketch.segments = [];
    isDrawing = false;
    previewPoint = null;
    startPointIndex = null;
}

function computeBoundingBox() {
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
    
    return { minX, maxX, minY, maxY };
}

function getSketchStats() {
    return {
        pointCount: sketch.points.length,
        segmentCount: sketch.segments.length
    };
}

// ============================================
// CANVAS DRAWING
// ============================================

function drawGrid() {
    const startX = Math.floor(viewport.offsetX - canvas.width / 2 / viewport.scale);
    const startY = Math.floor(viewport.offsetY - canvas.height / 2 / viewport.scale);
    const endX = Math.ceil(viewport.offsetX + canvas.width / 2 / viewport.scale);
    const endY = Math.ceil(viewport.offsetY + canvas.height / 2 / viewport.scale);
    
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    
    // Minor grid lines (1mm)
    for (let x = startX; x <= endX; x++) {
        const px = mmToPixel(x, 0).x;
        if (px >= 0 && px <= canvas.width) {
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvas.height);
            ctx.stroke();
        }
    }
    for (let y = startY; y <= endY; y++) {
        const py = mmToPixel(0, y).y;
        if (py >= 0 && py <= canvas.height) {
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(canvas.width, py);
            ctx.stroke();
        }
    }
    
    // Major grid lines (10mm)
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    for (let x = Math.floor(startX / MAJOR_GRID_INTERVAL) * MAJOR_GRID_INTERVAL; x <= endX; x += MAJOR_GRID_INTERVAL) {
        const px = mmToPixel(x, 0).x;
        if (px >= 0 && px <= canvas.width) {
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvas.height);
            ctx.stroke();
        }
    }
    for (let y = Math.floor(startY / MAJOR_GRID_INTERVAL) * MAJOR_GRID_INTERVAL; y <= endY; y += MAJOR_GRID_INTERVAL) {
        const py = mmToPixel(0, y).y;
        if (py >= 0 && py <= canvas.height) {
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(canvas.width, py);
            ctx.stroke();
        }
    }
}

function drawSketch() {
    // Draw segments
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    sketch.segments.forEach(seg => {
        const p1 = sketch.points[seg.start];
        const p2 = sketch.points[seg.end];
        const pixel1 = mmToPixel(p1.x, p1.y);
        const pixel2 = mmToPixel(p2.x, p2.y);
        
        ctx.beginPath();
        ctx.moveTo(pixel1.x, pixel1.y);
        ctx.lineTo(pixel2.x, pixel2.y);
        ctx.stroke();
    });
    
    // Draw points
    ctx.fillStyle = '#4a90e2';
    sketch.points.forEach(p => {
        const pixel = mmToPixel(p.x, p.y);
        ctx.beginPath();
        ctx.arc(pixel.x, pixel.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawPreview() {
    if (isDrawing && startPointIndex !== null) {
        const startPt = sketch.points[startPointIndex];
        const startPixel = mmToPixel(startPt.x, startPt.y);
        
        if (previewPoint) {
            const previewPixel = mmToPixel(previewPoint.x, previewPoint.y);
            
            // Draw preview line
            ctx.strokeStyle = '#4a90e2';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(startPixel.x, startPixel.y);
            ctx.lineTo(previewPixel.x, previewPixel.y);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw preview point
            ctx.fillStyle = '#4a90e2';
            ctx.beginPath();
            ctx.arc(previewPixel.x, previewPixel.y, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Highlight the start point
            ctx.fillStyle = '#4a90e2';
            ctx.beginPath();
            ctx.arc(startPixel.x, startPixel.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawCanvas() {
    if (!canvas || !ctx) {
        console.warn('Canvas or context not initialized');
        return;
    }
    
    // Fill with white background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawGrid();
    drawSketch();
    drawPreview();
}

// ============================================
// INPUT HANDLING
// ============================================

function handleCanvasInput(type, mouseX, mouseY) {
    const mm = pixelToMM(mouseX, mouseY);
    const snappedMM = snapToExistingPoint(mm.x, mm.y);
    
    if (type === 'down') {
        if (!isDrawing) {
            const nearestIndex = findNearestPoint(snappedMM.x, snappedMM.y, SNAP_RADIUS / viewport.scale);
            
            if (nearestIndex !== null) {
                startPointIndex = nearestIndex;
                isDrawing = true;
                previewPoint = null;
            } else {
                startPointIndex = sketch.points.length;
                sketch.points.push({ x: snappedMM.x, y: snappedMM.y });
                isDrawing = true;
                previewPoint = null;
            }
            drawCanvas();
        }
    } else if (type === 'move') {
        if (isDrawing) {
            previewPoint = { x: snappedMM.x, y: snappedMM.y };
            drawCanvas();
        }
    } else if (type === 'up') {
        if (isDrawing) {
            isDrawing = false;
            
            if (previewPoint) {
                const startPt = sketch.points[startPointIndex];
                const dist = Math.hypot(
                    previewPoint.x - startPt.x,
                    previewPoint.y - startPt.y
                );
                
                if (dist > 0.01) {
                    const nearestIndex = findNearestPoint(previewPoint.x, previewPoint.y, SNAP_RADIUS / viewport.scale);
                    let endPointIndex;
                    
                    if (nearestIndex !== null) {
                        endPointIndex = nearestIndex;
                    } else {
                        endPointIndex = sketch.points.length;
                        sketch.points.push({ x: previewPoint.x, y: previewPoint.y });
                    }
                    
                    sketch.segments.push({
                        start: startPointIndex,
                        end: endPointIndex
                    });
                }
            }
            
            previewPoint = null;
            startPointIndex = null;
            drawCanvas();
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

function initSketchCanvas() {
    console.log('Initializing sketch canvas...');
    canvas = document.getElementById('sketchCanvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }
    ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('Could not get 2D context!');
        return;
    }
    console.log('Canvas initialized:', canvas.width, 'x', canvas.height);
    
    function resizeCanvas() {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = 600;
        drawCanvas();
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Mouse event listeners
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        handleCanvasInput('down', e.clientX - rect.left, e.clientY - rect.top);
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        handleCanvasInput('move', e.clientX - rect.left, e.clientY - rect.top);
    });
    
    canvas.addEventListener('mouseup', (e) => {
        const rect = canvas.getBoundingClientRect();
        handleCanvasInput('up', e.clientX - rect.left, e.clientY - rect.top);
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (isDrawing) {
            isDrawing = false;
            previewPoint = null;
            startPointIndex = null;
            drawCanvas();
        }
    });
    
    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        handleCanvasInput('down', touch.clientX - rect.left, touch.clientY - rect.top);
    });
    
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        handleCanvasInput('move', touch.clientX - rect.left, touch.clientY - rect.top);
    });
    
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (e.changedTouches && e.changedTouches.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const touch = e.changedTouches[0];
            handleCanvasInput('up', touch.clientX - rect.left, touch.clientY - rect.top);
        }
    });
    
    drawCanvas();
}
