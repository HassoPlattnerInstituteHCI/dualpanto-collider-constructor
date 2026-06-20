// app.js - Main Application
// Load order: csg.js -> sketch.js -> geometry.js -> objExporter.js -> app.js

// ============================================
// STATE
// ============================================

let generatedOBJ = null;

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
    
    // Delete mode button
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            isDeleting = !isDeleting;
            deleteBtn.classList.toggle('active', isDeleting);
            deletionCandidates = [];
            drawCanvas();
            updateStatus();
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
    if (isDeleting || optionKeyPressed) {
        statusEl.textContent = deletionCandidates.length > 0 
            ? `${deletionCandidates.length} segment(s) to delete - click to remove` 
            : 'Delete mode: hover over segments to highlight';
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
    
    if (sketch.segments.length === 0) {
        alert('Please draw at least one hallway segment.');
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
    updateStatus();
    console.log('App initialized');
});

// Fallback in case DOMContentLoaded doesn't fire
window.onload = function() {
    if (!canvas) {
        console.log('Using window.onload fallback');
        initSketchCanvas();
        initControls();
        updateStatus();
    }
};
