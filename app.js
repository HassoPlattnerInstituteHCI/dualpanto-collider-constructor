// app.js - Main Application
// Load order: csg.js -> sketch.js -> geometry.js -> objExporter.js -> app.js

// ============================================
// STATE
// ============================================

let generatedOBJ = null;

// 3D Generation Settings - central values that can be easily adjusted
const EXTRUSION_HEIGHT = 10;  // mm - height of the extruded model
const HALLWAY_WIDTH = 1;      // mm - width of the hallways

// ============================================
// SKETCH SAVE/LOAD STATE
// ============================================

let currentSketchFile = null;      // Name of currently loaded/associated sketch (null if new/unsaved)
let lastSavedState = null;         // Last saved sketch state for dirty detection
let sketchDB = null;               // IndexedDB database instance
let isSketchDirty = false;         // Flag indicating unsaved changes
let pendingAction = null;          // For tracking async actions (save before load, etc.)
let appInitialized = false;        // Flag to track if app initialization is complete

// ============================================
// MODAL HELPERS
// ============================================

/**
 * Show a modal dialog
 */
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.hidden = false;
        // Focus first input if present
        const input = modal.querySelector('input');
        if (input) input.focus();
    }
}

/**
 * Hide a modal dialog
 */
function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.hidden = true;
    }
}

/**
 * Hide all modals
 */
function hideAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.hidden = true;
    });
}

// ============================================
// INDEXEDDB INITIALIZATION
// ============================================

/**
 * Initialize IndexedDB database for sketch storage
 */
function initSketchDB() {
    const request = indexedDB.open('SketchDatabase', 1);
    
    request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
    };
    
    request.onsuccess = (event) => {
        sketchDB = event.target.result;
        populateSketchDropdown();
        console.log('IndexedDB initialized, sketches loaded');
    };
    
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('sketches')) {
            db.createObjectStore('sketches');
        }
    };
}

/**
 * Get all sketch names from IndexedDB
 */
function getSketchNames(callback) {
    if (!sketchDB) {
        callback([]);
        return;
    }
    
    const transaction = sketchDB.transaction('sketches', 'readonly');
    const store = transaction.objectStore('sketches');
    const request = store.getAllKeys();
    
    request.onsuccess = () => {
        callback(request.result || []);
    };
    
    request.onerror = () => {
        callback([]);
    };
}

/**
 * Populate the sketch dropdown with saved sketches from IndexedDB
 */
function populateSketchDropdown() {
    const dropdown = document.getElementById('sketchDropdown');
    if (!dropdown) return;
    
    // Temporarily prevent change event handling during population
    let wasPopulating = dropdown.dataset.populating === 'true';
    dropdown.dataset.populating = 'true';
    
    getSketchNames((names) => {
        dropdown.innerHTML = '';
        
        if (names.length === 0) {
            // No saved sketches
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No saved sketches...';
            option.disabled = true;
            option.selected = true;
            dropdown.appendChild(option);
        } else {
            // Add placeholder for unsaved sketch
            if (currentSketchFile === null) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Unsaved Sketch';
                option.disabled = true;
                option.selected = true;
                dropdown.appendChild(option);
            }
            
            // Sort alphabetically and add saved sketches
            names.sort();
            names.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                if (name === currentSketchFile) {
                    option.selected = true;
                }
                dropdown.appendChild(option);
            });
        }
        
        // Re-enable change event handling
        dropdown.dataset.populating = wasPopulating ? 'true' : 'false';
    });
}

/**
 * Save sketch state to IndexedDB
 */
function saveSketchToDB(name, state) {
    if (!sketchDB) return Promise.reject(new Error('Database not initialized'));
    
    return new Promise((resolve, reject) => {
        const transaction = sketchDB.transaction('sketches', 'readwrite');
        const store = transaction.objectStore('sketches');
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        
        store.put(state, name);
    });
}

/**
 * Load sketch state from IndexedDB by name
 */
function loadSketchFromDB(name, callback) {
    if (!sketchDB) {
        callback(null);
        return;
    }
    
    const transaction = sketchDB.transaction('sketches', 'readonly');
    const store = transaction.objectStore('sketches');
    const request = store.get(name);
    
    request.onsuccess = () => {
        callback(request.result);
    };
    
    request.onerror = () => {
        callback(null);
    };
}

/**
 * Delete sketch from IndexedDB
 */
function deleteSketchFromDB(name, callback) {
    if (!sketchDB) {
        if (callback) callback(false);
        return;
    }
    
    const transaction = sketchDB.transaction('sketches', 'readwrite');
    const store = transaction.objectStore('sketches');
    
    transaction.oncomplete = () => {
        if (callback) callback(true);
    };
    transaction.onerror = () => {
        if (callback) callback(false);
    };
    
    store.delete(name);
}

// ============================================
// DIRTY STATE MANAGEMENT
// ============================================

/**
 * Check if the current sketch has unsaved changes
 */
function checkSketchDirty() {
    const currentState = exportSketchState();
    if (!lastSavedState) {
        // No last saved state means it's a new sketch (dirty if not empty)
        return sketch.points.length > 0 || sketch.segments.length > 0 || sketch.polygons.length > 0;
    }
    return !compareSketchStates(currentState, lastSavedState);
}

/**
 * Update the dirty state
 */
function updateDirtyState() {
    const wasDirty = isSketchDirty;
    isSketchDirty = checkSketchDirty();
    

    
    return isSketchDirty;
}

/**
 * Mark sketch as clean (call after save)
 */
function markSketchClean() {
    lastSavedState = exportSketchState();
    isSketchDirty = false;
}

/**
 * Mark sketch as dirty (call after modifications)
 */
function markSketchDirty() {
    isSketchDirty = true;
}

// ============================================
// SAVE/LOAD HANDLERS
// ============================================

/**
 * Show save modal to get sketch name
 */
function promptForSketchName() {
    // Don't show during initialization
    if (!appInitialized) return;
    
    const input = document.getElementById('sketchNameInput');
    if (input) {
        input.value = currentSketchFile || '';
    }
    showModal('saveModal');
}

/**
 * Save current sketch (main handler)
 */
function saveSketch() {
    const name = currentSketchFile;
    
    if (!name) {
        // Need to prompt for name
        promptForSketchName();
        return;
    }
    
    const state = exportSketchState();
    
    saveSketchToDB(name, state).then(() => {
        lastSavedState = state;
        isSketchDirty = false;
        populateSketchDropdown();
    }).catch(err => {
        console.error('Error saving sketch:', err);
    });
}

/**
 * Handle save confirmation from modal
 */
function handleSaveConfirm() {
    const input = document.getElementById('sketchNameInput');
    const name = input.value.trim();
    
    if (!name) {
        alert('Please enter a sketch name');
        return;
    }
    
    const state = exportSketchState();
    
    saveSketchToDB(name, state).then(() => {
        currentSketchFile = name;
        lastSavedState = state;
        isSketchDirty = false;
        hideModal('saveModal');
        populateSketchDropdown();
    }).catch(err => {
        console.error('Error saving sketch:', err);
    });
}

/**
 * Download current sketch as JSON file
 */
function downloadSketchJSON() {
    const state = exportSketchState();
    const name = currentSketchFile || 'sketch';
    const dataStr = JSON.stringify(state, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Load sketch from file picker
 */
function loadSketchFromFile() {
    const input = document.getElementById('fileImportInput');
    input.click();
}

/**
 * Handle file selection for import
 */
function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const state = JSON.parse(e.target.result);
            // Validate sketch state
            if (state && state.points && state.segments && state.polygons) {
                handleUnsavedChanges(() => {
                    importSketchState(state);
                    currentSketchFile = file.name.replace(/\.json$/, '');
                    lastSavedState = exportSketchState();
                    isSketchDirty = false;
                });
            } else {
                alert('Invalid sketch file format');
            }
        } catch (err) {
            alert('Error parsing sketch file: ' + err.message);
        }
    };
    reader.readAsText(file);
    
    // Reset input so same file can be selected again
    event.target.value = '';
}

/**
 * Handle loading a sketch from dropdown
 */
function loadSketchFromDropdown() {
    const dropdown = document.getElementById('sketchDropdown');
    // Don't handle during population
    if (dropdown.dataset.populating === 'true') return;
    
    const name = dropdown.value;
    
    if (!name) return;
    
    handleUnsavedChanges(() => {
        loadSketchFromDB(name, (state) => {
            if (state) {
                importSketchState(state);
                currentSketchFile = name;
                lastSavedState = exportSketchState();
                isSketchDirty = false;
                populateSketchDropdown();
            } else {
                alert('Error loading sketch');
            }
        });
    });
}

/**
 * Handle unsaved changes warning
 * callback is called if user chooses to continue (after optional save)
 */
function handleUnsavedChanges(callback) {
    // Don't show modal during initialization
    if (!appInitialized) {
        callback();
        return;
    }
    
    updateDirtyState();
    
    if (!isSketchDirty) {
        callback();
        return;
    }
    
    // Show unsaved changes modal
    showModal('unsavedModal');
    
    // Store callback for when user makes choice
    pendingAction = callback;
}

/**
 * Handle unsaved changes - Save and continue
 */
function handleUnsavedSaveAndContinue() {
    hideModal('unsavedModal');
    
    if (currentSketchFile) {
        saveSketch();
        // Wait for save to complete before continuing
        setTimeout(() => {
            if (pendingAction) {
                pendingAction();
                pendingAction = null;
            }
        }, 100);
    } else {
        // Prompt for name, then save and continue
        pendingAction = () => {
            hideModal('saveModal');
            if (pendingAction) {
                const callback = pendingAction;
                pendingAction = null;
                callback();
            }
        };
        promptForSketchName();
    }
}

/**
 * Handle unsaved changes - Discard and continue
 */
function handleUnsavedDiscardAndContinue() {
    hideModal('unsavedModal');
    if (pendingAction) {
        pendingAction();
        pendingAction = null;
    }
}

/**
 * Handle unsaved changes - Cancel
 */
function handleUnsavedCancel() {
    hideModal('unsavedModal');
    pendingAction = null;
}

/**
 * Create new sketch (with unsaved changes warning)
 */
function newSketch() {
    handleUnsavedChanges(() => {
        clearSketch();
        generatedOBJ = null;
        currentSketchFile = null;
        lastSavedState = null;
        isSketchDirty = false;
        drawCanvas();
        updateStatus();
        populateSketchDropdown();
    });
}

// ============================================
// TOOL MANAGEMENT
// ============================================

function initToolShortcuts() {
    window.addEventListener('keydown', (e) => {
        // Don't trigger tool shortcuts when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // Tool selection keyboard shortcuts
        if (e.key && !e.ctrlKey && !e.metaKey && !e.altKey) {
            switch (e.key.toLowerCase()) {
                case 'h':
                    setTool('line');
                    e.preventDefault();
                    break;
                case 'p':
                    setTool('polygon');
                    e.preventDefault();
                    break;
                case 'r':
                    setTool('rectangle');
                    e.preventDefault();
                    break;
                case 'o':
                    setTool('orthogonal');
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
        previewPoint = null;
        window.polygonBeforeState = null; // Clean up saved state
    }
    if (toolName !== 'rectangle') {
        isDrawingRectangle = false;
        rectangleStartIndex = null;
        rectangleAddedPoints = [];
        previewPoint = null;
        window.rectangleBeforeState = null; // Clean up saved state
    }
    if (toolName !== 'orthogonal') {
        isDrawingOrthogonal = false;
        orthoStartIndex = null;
        orthoAddedPoints = [];
        previewPoint = null;
        window.orthoBeforeState = null; // Clean up saved state
    }
    
    // Clear move vertex state when switching away from move
    if (toolName !== 'move') {
        isMovingVertex = false;
        moveVertexCandidates = [];
        dragStartMM = null;
        dragOriginalPositions = null;
        moveClosestEdge = null;
        moveClosestEdges = [];
    }
    
    // Clear deletion candidates when switching away from delete
    if (toolName !== 'delete') {
        deletionCandidates = [];
        polygonDeletionCandidates = [];
    }
    
    // Update canvas cursor based on new tool
    if (typeof updateCanvasCursor === 'function') {
        updateCanvasCursor();
    }
    
    drawCanvas();
    updateStatus();
}

// ============================================
// UI CONTROLS
// ============================================

function initControls() {
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
    
    // Clear button
    document.getElementById('clearBtn').addEventListener('click', () => {
        clearSketch();
        generatedOBJ = null;
        updateStatus();
        drawCanvas();
    });
    
    // Undo button
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            undo();
        });
    }
    
    // Redo button
    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            redo();
        });
    }
    
    // Download button - generates a new model from current sketch every time
    document.getElementById('downloadBtn').addEventListener('click', () => {
        generate3DModel(() => {
            const segmentCount = sketch.segments.length;
            downloadOBJ(generatedOBJ, `maze_${segmentCount}_segments.obj`);
        });
    });
    
    // Save/Load controls
    initSaveLoadControls();
    
    // Help button - toggles modal and changes icon
    const helpBtn = document.getElementById('helpBtn');
    const helpModal = document.getElementById('helpModal');
    if (helpBtn && helpModal) {
        helpBtn.addEventListener('click', () => {
            const isOpen = !helpModal.hidden;
            if (isOpen) {
                hideModal('helpModal');
                helpBtn.classList.remove('open');
                helpBtn.textContent = '?';
                helpBtn.title = 'Show Help';
            } else {
                showModal('helpModal');
                helpBtn.classList.add('open');
                helpBtn.textContent = '×';
                helpBtn.title = 'Close Help';
            }
        });
        
        // Close help modal when clicking outside
        helpModal.parentElement.addEventListener('click', (e) => {
            if (e.target === helpModal.parentElement) {
                hideModal('helpModal');
                helpBtn.classList.remove('open');
                helpBtn.textContent = '?';
                helpBtn.title = 'Show Help';
            }
        });
    }
    
    updateStatus();
}

/**
 * Initialize save/load control event handlers
 */
function initSaveLoadControls() {
    // Save button
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSketch);
    }
    
    // Save modal buttons
    const saveConfirmBtn = document.getElementById('saveConfirmBtn');
    if (saveConfirmBtn) {
        saveConfirmBtn.addEventListener('click', handleSaveConfirm);
    }
    
    const saveCancelBtn = document.getElementById('saveCancelBtn');
    if (saveCancelBtn) {
        saveCancelBtn.addEventListener('click', () => hideModal('saveModal'));
    }
    
    // New Sketch button
    const newSketchBtn = document.getElementById('newSketchBtn');
    if (newSketchBtn) {
        newSketchBtn.addEventListener('click', newSketch);
    }
    
    // Download JSON button
    const downloadSketchBtn = document.getElementById('downloadSketchBtn');
    if (downloadSketchBtn) {
        downloadSketchBtn.addEventListener('click', downloadSketchJSON);
    }
    
    // Load from File button
    const loadFromFileBtn = document.getElementById('loadFromFileBtn');
    if (loadFromFileBtn) {
        loadFromFileBtn.addEventListener('click', loadSketchFromFile);
    }
    
    // File import input
    const fileImportInput = document.getElementById('fileImportInput');
    if (fileImportInput) {
        fileImportInput.addEventListener('change', handleFileImport);
    }
    
    // Sketch dropdown
    const sketchDropdown = document.getElementById('sketchDropdown');
    if (sketchDropdown) {
        sketchDropdown.addEventListener('change', loadSketchFromDropdown);
    }
    
    // Unsaved changes modal buttons
    const unsavedSaveBtn = document.getElementById('unsavedSaveBtn');
    if (unsavedSaveBtn) {
        unsavedSaveBtn.addEventListener('click', handleUnsavedSaveAndContinue);
    }
    
    const unsavedDiscardBtn = document.getElementById('unsavedDiscardBtn');
    if (unsavedDiscardBtn) {
        unsavedDiscardBtn.addEventListener('click', handleUnsavedDiscardAndContinue);
    }
    
    const unsavedCancelBtn = document.getElementById('unsavedCancelBtn');
    if (unsavedCancelBtn) {
        unsavedCancelBtn.addEventListener('click', handleUnsavedCancel);
    }
    
    // Modal overlay click to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.hidden = true;
                pendingAction = null;
            }
        });
    });
}

function updateStatus() {
    // Only keeping undo/redo button updates after removing status bar elements
    updateUndoRedoButtons();
}

// ============================================
// UNDO/REDO UI
// ============================================

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    
    if (undoBtn) {
        undoBtn.disabled = !canUndo();
    }
    if (redoBtn) {
        redoBtn.disabled = !canRedo();
    }
}

// ============================================
// 3D GENERATION
// ============================================

function generate3DModel(callback) {
    if (sketch.segments.length === 0 && (!sketch.polygons || sketch.polygons.length === 0)) {
        alert('Please draw at least one hallway segment or polygon.');
        return;
    }
    
    setTimeout(() => {
        try {
            generatedOBJ = generateOBJFromSketch(sketch, EXTRUSION_HEIGHT, HALLWAY_WIDTH);
            
            document.getElementById('downloadBtn').disabled = false;
            
            // Log stats
            const vertexCount = (generatedOBJ.match(/^v /gm) || []).length;
            const faceCount = (generatedOBJ.match(/^f /gm) || []).length;
            console.log(`Generated model: ${vertexCount} vertices, ${faceCount} faces`);
            
            if (callback) callback();
        } catch (e) {
            console.error('Error generating 3D model:', e, e.stack);
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
    initSketchDB();
    updateStatus();
    
    // Mark app as initialized (after a brief delay to ensure IndexedDB is ready)
    setTimeout(() => {
        appInitialized = true;
        console.log('App fully initialized');
    }, 100);
});

// Fallback in case DOMContentLoaded doesn't fire
window.onload = function() {
    if (!canvas) {
        console.log('Using window.onload fallback');
        initSketchCanvas();
        initControls();
        initToolShortcuts();
        initSketchDB();
        updateStatus();
        hideAllModals();
        hideModal("saveModal");
        hideModal("unsavedModal");
        
        setTimeout(() => {
            appInitialized = true;
            console.log('App fully initialized');
        }, 100);
    }
};
