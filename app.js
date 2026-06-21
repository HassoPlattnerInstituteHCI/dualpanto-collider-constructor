// app.js - Main Application
// Load order: csg.js -> sketch.js -> geometry.js -> objExporter.js -> app.js

// ============================================
// STATE
// ============================================

let generatedOBJ = null;

// ============================================
// TOOL MANAGEMENT
// ============================================

function initToolShortcuts() {
    window.addEventListener('keydown', (e) => {
        // Tool selection keyboard shortcuts
        if (e.key && !e.ctrlKey && !e.metaKey && !e.altKey) {
            switch (e.key.toLowerCase()) {
                case 'l':
                    setTool('line');
                    e.preventDefault();
                    break;
                case 'p':
                    setTool('polygon');
                    e.preventDefault();
                    break;
                case 'm':
                    setTool('move');
                    e.preventDefault();
                    break;
                case 'd':
                    setTool('delete');
                    e.preventDefault();
                    break;
            }
        }
    });
}

function setTool(toolName) {
    currentTool = toolName;
    
    // Update UI
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === toolName);
    });
    
    // Sync with deletion mode
    isDeleting = (toolName === 'delete');
    
    // Reset drawing states when switching tools
    if (toolName !== 'line') {
        isDrawing = false;
        previewPoint = null;
        startPointIndex = null;
        newPointAdded = false;
    }
    if (toolName !== 'polygon') {
        isDrawingPolygon = false;
        polygonVertices = [];
        polygonStartIndex = null;
        polygonAddedPoints = [];
    }
    
    // Clear move vertex state when switching away from move
    if (toolName !== 'move') {
        isMovingVertex = false;
        moveVertexCandidates = [];
        dragStartMM = null;
        dragOriginalPositions = null;
    }
    
    // Clear deletion candidates when switching away from delete
    if (toolName !== 'delete') {
        deletionCandidates = [];
        polygonDeletionCandidates = [];
    }
    
    drawCanvas();
    updateStatus();
}

// ============================================
// UI CONTROLS
// ============================================

function initControls() {
    // Grid granularity slider
    const granularitySlider = document.getElementById('gridGranularity');
    const granularityValue = document.getElementById('granularityValue');
    
    if (granularitySlider && granularityValue) {
        granularitySlider.addEventListener('input', (e) => {
            gridGranularity = parseFloat(e.target.value);
            granularityValue.textContent = gridGranularity.toFixed(1);
            drawCanvas();
        });
    }
    
    // Reset view button
    const resetViewBtn = document.getElementById('resetViewBtn');
    if (resetViewBtn) {
        resetViewBtn.addEventListener('click', () => {
            resetViewport();
            updateStatus();
        });
    }
    
    // Tool selector buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setTool(btn.dataset.tool);
        });
    });
    
    // Delete mode button (for backwards compatibility)
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            setTool('delete');
        });
    }
    
    // Clear button
    document.getElementById('clearBtn').addEventListener('click', () => {
        clearSketch();
        generatedOBJ = null;
        document.getElementById('downloadBtn').disabled = true;
        updateStatus();
        drawCanvas();
    });
    
    // Extrude button
    document.getElementById('extrudeBtn').addEventListener('click', generate3DModel);
    
    // Download button
    document.getElementById('downloadBtn').addEventListener('click', () => {
        if (generatedOBJ) {
            const segmentCount = sketch.segments.length;
            downloadOBJ(generatedOBJ, `maze_${segmentCount}_segments.obj`);
        }
    });
    
    updateStatus();
}

function updateStatus() {
    const stats = getSketchStats();
    document.getElementById('pointCount').textContent = `Points: ${stats.pointCount}`;
    document.getElementById('segmentCount').textContent = `Segments: ${stats.segmentCount}`;
    
    const statusEl = document.getElementById('statusMessage');
    
    if (isDeleting || optionKeyPressed || currentTool === 'delete') {
        if (polygonDeletionCandidates.length > 0) {
            statusEl.textContent = `${polygonDeletionCandidates.length} polygon(s) to delete - click to remove`;
        } else if (deletionCandidates.length > 0) {
            statusEl.textContent = `${deletionCandidates.length} segment(s) to delete - click to remove`;
        } else {
            statusEl.textContent = 'Delete mode: hover over segments or polygons to highlight';
        }
    } else if (currentTool === 'polygon') {
        if (isDrawingPolygon) {
            statusEl.textContent = `Polygon: ${polygonVertices.length} vertices - click first point to close or press Enter/Escape`;
        } else {
            statusEl.textContent = stats.polygonCount > 0 
                ? `${stats.polygonCount} polygon(s), ${stats.segmentCount} hallway segment(s)` 
                : stats.segmentCount > 0 ? `${stats.segmentCount} hallway segment(s)` : 'Ready';
        }
    } else if (currentTool === 'move') {
        if (moveVertexCandidates.length > 0) {
            statusEl.textContent = `${moveVertexCandidates.length} vertex/vertices to move - click and drag`;
        } else {
            statusEl.textContent = 'Move mode: hover over vertices to highlight';
        }
    } else {
        statusEl.textContent = stats.segmentCount > 0 ? 
            `${stats.segmentCount} hallway segment(s) drawn` : 'Ready';
    }
}

// ============================================
// 3D GENERATION
// ============================================

function generate3DModel() {
    const extrusionHeight = parseFloat(document.getElementById('extrusionHeight').value) || 10;
    const hallwayWidth = parseFloat(document.getElementById('hallwayWidth').value) || 5;
    
    if (extrusionHeight <= 0 || hallwayWidth <= 0) {
        alert('Please enter positive values for extrusion height and hallway width.');
        return;
    }
    
    if (sketch.segments.length === 0 && (sketch.polygons || sketch.polygons.length === 0)) {
        alert('Please draw at least one hallway segment or polygon.');
        return;
    }
    
    document.getElementById('statusMessage').textContent = 'Generating 3D model...';
    
    setTimeout(() => {
        try {
            document.getElementById('statusMessage').textContent = 'Building geometry...';
            generatedOBJ = generateOBJFromSketch(sketch, extrusionHeight, hallwayWidth);
            
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('statusMessage').textContent = '3D model generated - ready to download';
            
            // Log stats
            const vertexCount = (generatedOBJ.match(/^v /gm) || []).length;
            const faceCount = (generatedOBJ.match(/^f /gm) || []).length;
            console.log(`Generated model: ${vertexCount} vertices, ${faceCount} faces`);
        } catch (e) {
            console.error('Error generating 3D model:', e, e.stack);
            document.getElementById('statusMessage').textContent = `Error: ${e.message || String(e)}`;
        }
    }, 10);
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    initSketchCanvas();
    initControls();
    initToolShortcuts();
    updateStatus();
    console.log('App initialized');
});

// Fallback in case DOMContentLoaded doesn't fire
window.onload = function() {
    if (!canvas) {
        console.log('Using window.onload fallback');
        initSketchCanvas();
        initControls();
        initToolShortcuts();
        updateStatus();
    }
};
