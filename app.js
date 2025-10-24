
// Global state
const state = {
    currentFile: null,
    currentData: null,
    annotations: {},
    files: [],
    sessionId: null,
    timeTracker: {
        startTime: null,
        currentFileStartTime: null
    }
};

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Initialize the app
function init() {
    // Add closest polyfill for older browsers
    if (!Element.prototype.closest) {
        Element.prototype.closest = function(s) {
            var el = this;
            do {
                if (el.matches(s)) return el;
                el = el.parentElement || el.parentNode;
            } while (el !== null && el.nodeType === 1);
            return null;
        };
    }
    
    setupEventListeners();
    
    // Try to load previous progress from localStorage
    if (loadFromLocalStorage()) {
        showStatus('info', 'Previous progress found. Load your folder to continue where you left off.');
    }
}

function setupEventListeners() {
    // Folder input
    $('#folderInput').addEventListener('change', handleFolderSelection);
    
    // Save and load buttons
    $('#saveBtn').addEventListener('click', saveProgress);
    $('#loadBtn').addEventListener('click', loadProgress);
    $('#clearBtn').addEventListener('click', clearProgress);
    
    // Export button
    $('#exportBtn').addEventListener('click', exportAnnotations);
    
    // Auto-save on annotation changes
    setInterval(autoSave, 30000); // Auto-save every 30 seconds
}

function handleFolderSelection(event) {
    const files = Array.from(event.target.files);
    const wooversightFiles = files.filter(file => 
        file.name.includes('wooversight') && file.name.endsWith('.json')
    );

    if (wooversightFiles.length === 0) {
        showStatus('warning', 'No wooversight files found in the selected folders.');
        return;
    }

    state.files = wooversightFiles;
    displayFileList();
    showStatus('success', `Found ${wooversightFiles.length} wooversight files.`);
}

function displayFileList() {
    const fileList = $('#fileList');
    const fileItems = $('#fileItems');
    
    fileList.style.display = 'block';
    fileItems.innerHTML = '';

    state.files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        
        // Check if file is properly completed
        const isCompleted = isFileCompleted(file.name);
        
        item.innerHTML = `
            <span>${file.name}</span>
            <span class="status-indicator ${isCompleted ? 'status-completed' : 'status-pending'}"></span>
        `;
        
        item.addEventListener('click', () => loadFile(file));
        fileItems.appendChild(item);
    });
}

function isFileCompleted(fileName) {
    const annotation = state.annotations[fileName];
    if (!annotation) return false;
    
    // Must have a scheming decision (true or false)
    if (typeof annotation.scheming !== 'boolean') return false;
    
    // Must have a confidence selection
    if (!annotation.confidence) return false;
    
    // If scheming is true, must have at least one highlight
    if (annotation.scheming === true) {
        return annotation.highlights && annotation.highlights.length > 0;
    }
    
    // If scheming is false, it's completed
    return true;
}

async function loadFile(file) {
    try {
        // Stop timing previous file if exists
        if (state.currentFile && state.timeTracker.currentFileStartTime) {
            updateFileTime();
        }
        
        const content = await readFileContent(file);
        const data = JSON.parse(content);
        
        state.currentFile = file.name;
        state.currentData = data;
        
        // Start timing this file
        state.timeTracker.currentFileStartTime = new Date();
        
        // Update file list UI
        $$('.file-item').forEach(item => item.classList.remove('active'));
        // Find the file item that corresponds to this file
        const fileItems = $$('.file-item');
        for (let item of fileItems) {
            if (item.textContent.includes(file.name)) {
                item.classList.add('active');
                break;
            }
        }
        
        displayContent(data);
        updateStatus();
    } catch (error) {
        showStatus('warning', `Error loading ${file.name}: ${error.message}`);
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

function displayContent(data) {
    const mainContent = $('#mainContent');
    
    // Extract the main content to display
    let content = '';
    if (data.input && data.input.with_oversight && data.input.without_oversight) {
        content = `WITH OVERSIGHT:\n${JSON.stringify(data.input.with_oversight, null, 2)}\n\nWITHOUT OVERSIGHT:\n${JSON.stringify(data.input.without_oversight, null, 2)}`;
    } else if (data.input && data.input.Qwen && data.input.Qwen.length > 0) {
        // Handle single conversation format - format it nicely
        let conversationText = '';
        data.input.Qwen.forEach((turn, index) => {
            if (turn.source === 'user') {
                conversationText += `\n👤 USER:\n${turn.content}\n`;
            } else if (turn.source === 'assistant') {
                conversationText += `\n🤖 ASSISTANT:\n${turn.content}\n`;
            } else {
                conversationText += `\n📝 ${turn.source.toUpperCase()}:\n${turn.content}\n`;
            }
            conversationText += '\n' + '─'.repeat(50) + '\n';
        });
        content = `CONVERSATION:${conversationText}`;
    } else if (data.input) {
        // Handle other input formats
        content = `INPUT:\n${JSON.stringify(data.input, null, 2)}`;
    } else {
        content = JSON.stringify(data, null, 2);
    }

    mainContent.innerHTML = `
        <div class="card">
            <h2>📄 ${state.currentFile}</h2>
            <div class="scheming-question">
                Has scheming occurred in this interaction?
            </div>
            
            <div class="annotation-controls">
                <button id="schemingYes" class="btn btn-success"> Yes, Scheming Detected</button>
                <button id="schemingNo" class="btn btn-danger"> No Scheming</button>
                <button id="highlightBtn" class="btn btn-primary" style="display: none;">🎯 Highlight Text</button>
            </div>
            
            <div class="confidence-controls" id="confidenceControls" style="display: none;">
                <div class="confidence-question">
                    How confident are you in this annotation?
                </div>
                <div class="confidence-buttons">
                    <button id="confidenceHigh" class="btn btn-success btn-sm">High Confidence</button>
                    <button id="confidenceLow" class="btn btn-warning btn-sm">Low Confidence</button>
                </div>
                <div class="comments-section">
                    <label for="commentsInput">Additional Comments (optional):</label>
                    <textarea id="commentsInput" placeholder="Add any additional notes about this annotation..." rows="3"></textarea>
                </div>
            </div>
            
            <div class="content-display" id="contentDisplay">
                ${escapeHtml(content)}
            </div>
            
            <div class="annotation-panel" id="annotationPanel" style="display: none;">
                <h3>Annotations</h3>
                <div id="annotationList"></div>
            </div>
            
            <div id="fileRepository" class="file-repository" style="display: none;">
                <h3>📁 File Repository</h3>
                <div id="repoContent" class="repo-content"></div>
            </div>
        </div>
    `;

    // Setup event listeners for new content
    setupContentEventListeners();
    displayAnnotations();
    
    // Show file repository if available
    setTimeout(() => {
        showFileRepository();
    }, 100);
}

function setupContentEventListeners() {
    $('#schemingYes').addEventListener('click', () => markScheming(true));
    $('#schemingNo').addEventListener('click', () => markScheming(false));
    $('#highlightBtn').addEventListener('click', enableHighlighting);
    
    // Confidence controls
    $('#confidenceHigh').addEventListener('click', () => setConfidence('high'));
    $('#confidenceLow').addEventListener('click', () => setConfidence('low'));
    $('#commentsInput').addEventListener('input', updateComments);
    
    // Text selection for highlighting
    const contentDisplay = $('#contentDisplay');
    contentDisplay.addEventListener('mouseup', handleTextSelection);
}

function markScheming(hasScheming) {
    if (!state.currentFile) return;
    
    // Update time for current file
    updateFileTime();
    
    if (!state.annotations[state.currentFile]) {
        state.annotations[state.currentFile] = {
            scheming: hasScheming,
            highlights: [],
            startTime: new Date().toISOString(),
            totalTime: 0,
            confidence: null,
            comments: ''
        };
    } else {
        // If changing from scheming to no scheming, clear highlights
        if (state.annotations[state.currentFile].scheming && !hasScheming) {
            state.annotations[state.currentFile].highlights = [];
            // Remove all visual highlights
            document.querySelectorAll('.highlight.scheming').forEach(highlight => {
                highlight.outerHTML = highlight.textContent;
            });
        }
        state.annotations[state.currentFile].scheming = hasScheming;
    }
    
    updateStatus();
    displayAnnotations();
    autoSave(); // Save immediately on annotation change
    
    // Show confidence controls after marking scheming
    $('#confidenceControls').style.display = 'block';
    
    // Load existing confidence and comments if available
    if (state.annotations[state.currentFile]) {
        const annotation = state.annotations[state.currentFile];
        if (annotation.confidence) {
            updateConfidenceButtons(annotation.confidence);
        }
        if (annotation.comments) {
            $('#commentsInput').value = annotation.comments;
        }
    }
    
    if (hasScheming) {
        $('#highlightBtn').style.display = 'inline-block';
        showStatus('success', 'Scheming marked. You can now highlight specific text.');
    } else {
        $('#highlightBtn').style.display = 'none';
        showStatus('success', 'No scheming marked. Highlights removed.');
    }
}

function setConfidence(confidenceLevel) {
    if (!state.currentFile || !state.annotations[state.currentFile]) return;
    
    state.annotations[state.currentFile].confidence = confidenceLevel;
    updateConfidenceButtons(confidenceLevel);
    autoSave(); // Save immediately on confidence change
    showStatus('success', `Confidence set to: ${confidenceLevel}`);
}

function updateConfidenceButtons(confidenceLevel) {
    // Reset button styles
    $('#confidenceHigh').classList.remove('btn-success', 'btn-outline-success');
    $('#confidenceLow').classList.remove('btn-warning', 'btn-outline-warning');
    
    // Set active button style
    if (confidenceLevel === 'high') {
        $('#confidenceHigh').classList.add('btn-success');
        $('#confidenceLow').classList.add('btn-outline-warning');
    } else if (confidenceLevel === 'low') {
        $('#confidenceHigh').classList.add('btn-outline-success');
        $('#confidenceLow').classList.add('btn-warning');
    }
}

function updateComments() {
    if (!state.currentFile || !state.annotations[state.currentFile]) return;
    
    state.annotations[state.currentFile].comments = $('#commentsInput').value;
    autoSave(); // Save immediately on comments change
}

function enableHighlighting() {
    const contentDisplay = $('#contentDisplay');
    contentDisplay.style.cursor = 'crosshair';
    contentDisplay.addEventListener('mouseup', handleTextSelection);
    showStatus('info', 'Click and drag to highlight text where scheming occurs.');
}

function handleTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.toString().trim() === '') return;
    
    // Only allow highlighting if scheming is marked as true
    if (!state.annotations[state.currentFile] || !state.annotations[state.currentFile].scheming) {
        showStatus('warning', 'Please mark "Yes, Scheming Detected" before highlighting text.');
        return;
    }
    
    const text = selection.toString();
    const range = selection.getRangeAt(0);
    
    // Show confirmation dialog in the UI instead of browser popup
    showHighlightConfirmation(text, range, selection);
}

function showHighlightConfirmation(text, range, selection) {
    // Create a confirmation dialog in the UI
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #3182ce;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        max-width: 500px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    const previewText = text.length > 100 ? text.substring(0, 100) + '...' : text;
    
    dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0; color: #1a202c;">Highlight Text as Scheming?</h3>
        <p style="margin: 0 0 16px 0; color: #4a5568; font-size: 14px;">Selected text:</p>
        <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px; margin: 0 0 16px 0; font-family: monospace; font-size: 13px; max-height: 120px; overflow-y: auto;">
            "${previewText}"
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancelHighlight" style="padding: 8px 16px; border: 1px solid #e2e8f0; background: white; border-radius: 4px; cursor: pointer; font-size: 14px;">Cancel</button>
            <button id="confirmHighlight" style="padding: 8px 16px; border: 1px solid #3182ce; background: #3182ce; color: white; border-radius: 4px; cursor: pointer; font-size: 14px;">Highlight</button>
        </div>
    `;
    
    // Add backdrop
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.3);
        z-index: 999;
    `;
    
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    
    // Event listeners
    document.getElementById('cancelHighlight').addEventListener('click', () => {
        document.body.removeChild(backdrop);
        document.body.removeChild(dialog);
        selection.removeAllRanges();
    });
    
    document.getElementById('confirmHighlight').addEventListener('click', () => {
        addHighlight(text, range);
        selection.removeAllRanges();
        document.body.removeChild(backdrop);
        document.body.removeChild(dialog);
    });
    
    // Close on backdrop click
    backdrop.addEventListener('click', () => {
        document.body.removeChild(backdrop);
        document.body.removeChild(dialog);
        selection.removeAllRanges();
    });
}

function addHighlight(text, range) {
    if (!state.annotations[state.currentFile]) {
        // Don't create annotation automatically - user must first decide on scheming
        showStatus('warning', 'Please first decide if scheming occurred before highlighting text.');
        return;
    }
    
    const highlight = {
        id: Date.now(),
        text: text
    };
    
    state.annotations[state.currentFile].highlights.push(highlight);
    
    // Apply visual highlight
    const span = document.createElement('span');
    span.className = 'highlight scheming';
    span.textContent = text;
    span.dataset.highlightId = highlight.id;
    span.title = 'Click to remove highlight';
    span.style.cursor = 'pointer';
    
    // Add click listener to remove highlight
    span.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeHighlight(highlight.id);
    });
    
    try {
        range.deleteContents();
        range.insertNode(span);
    } catch (e) {
        console.error('Error applying highlight:', e);
    }
    
    displayAnnotations();
    autoSave(); // Save immediately on highlight addition
    showStatus('success', 'Text highlighted as scheming. Click highlight to remove.');
}

function displayAnnotations() {
    const annotationPanel = $('#annotationPanel');
    const annotationList = $('#annotationList');
    
    if (!state.currentFile || !state.annotations[state.currentFile]) {
        annotationPanel.style.display = 'none';
        return;
    }
    
    const annotations = state.annotations[state.currentFile];
    annotationPanel.style.display = 'block';
    
    let html = `<div class="alert ${annotations.scheming ? 'alert-warning' : 'alert-success'}">
        <strong>Scheming Status:</strong> ${annotations.scheming ? '❌ YES - Scheming Detected' : '✅ NO - No Scheming'}
    </div>`;
    
    // Add confidence information
    if (annotations.confidence) {
        const confidenceIcon = annotations.confidence === 'high' ? '🟢' : '🟡';
        const confidenceText = annotations.confidence === 'high' ? 'High Confidence' : 'Low Confidence';
        html += `<div class="alert alert-info">
            <strong>Confidence:</strong> ${confidenceIcon} ${confidenceText}
        </div>`;
    }
    
    // Add comments if available
    if (annotations.comments && annotations.comments.trim()) {
        html += `<div class="alert alert-light">
            <strong>Comments:</strong><br>
            ${escapeHtml(annotations.comments)}
        </div>`;
    }
    
    if (annotations.highlights && annotations.highlights.length > 0) {
        html += '<h4>Highlighted Text:</h4>';
        annotations.highlights.forEach(highlight => {
            html += `
                <div class="annotation-item">
                    <div class="annotation-text">${escapeHtml(highlight.text)}</div>
                    <button class="delete-btn" onclick="removeHighlight(${highlight.id})">🗑️</button>
                </div>
            `;
        });
    }
    
    annotationList.innerHTML = html;
}

function removeHighlight(highlightId) {
    if (!state.annotations[state.currentFile]) return;
    
    state.annotations[state.currentFile].highlights = 
        state.annotations[state.currentFile].highlights.filter(h => h.id !== highlightId);
    
    // Remove visual highlight
    const highlightElement = document.querySelector(`[data-highlight-id="${highlightId}"]`);
    if (highlightElement) {
        highlightElement.outerHTML = highlightElement.textContent;
    }
    
    displayAnnotations();
    autoSave(); // Save immediately on highlight removal
    showStatus('success', 'Highlight removed.');
}

function updateFileTime() {
    if (!state.currentFile || !state.timeTracker.currentFileStartTime) return;
    
    const currentTime = new Date();
    const timeSpent = currentTime - state.timeTracker.currentFileStartTime;
    
    if (!state.annotations[state.currentFile]) {
        // Don't create annotation automatically - user must first decide on scheming
        return;
    }
    
    state.annotations[state.currentFile].totalTime += timeSpent;
    state.timeTracker.currentFileStartTime = currentTime;
}

function formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function updateStatus() {
    const completed = Object.keys(state.annotations).length;
    const total = state.files.length;
    
    // Update time for current file
    updateFileTime();
    
    const statusContent = $('#statusContent');
    let statusHtml = `
        <div class="alert alert-info">
            <strong>Progress:</strong> ${completed}/${total} files annotated
        </div>
    `;
    
    if (state.sessionId) {
        statusHtml += `
            <div class="alert alert-success">
                <strong>Session ID:</strong> ${state.sessionId}<br>
                <small>Progress is being auto-saved</small>
            </div>
        `;
    }
    
    statusContent.innerHTML = statusHtml;
    
    // Update file list indicators
    displayFileList();
    
    // Enable export if we have annotations
    $('#exportBtn').disabled = completed === 0;
}

function showStatus(type, message) {
    const statusContent = $('#statusContent');
    const alertClass = `alert-${type}`;
    statusContent.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
}

function saveProgress() {
    if (Object.keys(state.annotations).length === 0) {
        showStatus('warning', 'No annotations to save.');
        return;
    }
    
    const saveData = {
        sessionId: state.sessionId || generateSessionId(),
        save_timestamp: new Date().toISOString(),
        total_files: state.files.length,
        annotated_files: Object.keys(state.annotations).length,
        annotations: state.annotations,
        file_names: state.files.map(f => f.name)
    };
    
    // Save to localStorage
    localStorage.setItem('scheming_annotations_progress', JSON.stringify(saveData));
    state.sessionId = saveData.sessionId;
    
    // Also offer to download as backup
    const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheming_annotations_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('success', 'Progress saved locally and backup downloaded!');
}

function loadProgress() {
    // Create file input for loading saved progress
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const saveData = JSON.parse(e.target.result);
                
                // Validate the save data
                if (!saveData.annotations || !saveData.file_names) {
                    showStatus('warning', 'Invalid save file format.');
                    return;
                }
                
                // Restore state
                state.annotations = saveData.annotations;
                state.sessionId = saveData.sessionId;
                
                // Update UI
                updateStatus();
                displayFileList();
                
                showStatus('success', `Loaded progress: ${Object.keys(state.annotations).length} files annotated`);
                
                // If we have a current file, refresh its display
                if (state.currentFile && state.annotations[state.currentFile]) {
                    displayAnnotations();
                }
                
            } catch (error) {
                showStatus('warning', `Error loading save file: ${error.message}`);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function autoSave() {
    if (Object.keys(state.annotations).length === 0) return;
    
    const saveData = {
        sessionId: state.sessionId || generateSessionId(),
        save_timestamp: new Date().toISOString(),
        total_files: state.files.length,
        annotated_files: Object.keys(state.annotations).length,
        annotations: state.annotations,
        file_names: state.files.map(f => f.name)
    };
    
    localStorage.setItem('scheming_annotations_progress', JSON.stringify(saveData));
    state.sessionId = saveData.sessionId;
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('scheming_annotations_progress');
        if (saved) {
            const saveData = JSON.parse(saved);
            state.annotations = saveData.annotations || {};
            state.sessionId = saveData.sessionId;
            return true;
        }
    } catch (error) {
        console.error('Error loading from localStorage:', error);
    }
    return false;
}

function clearProgress() {
    showClearConfirmation();
}

function showFileRepository() {
    const fileRepo = $('#fileRepository');
    if (!fileRepo) {
        console.log('File repository element not found');
        return;
    }
    
    console.log('Showing file repository');
    // Always show file repository
    fileRepo.style.display = 'block';
    
    const currNum = state.currentFile.split('_')[2].replace('.json', '');
    // Load file comparison directly
    // console.log('Loading actual files for example:', currNum);
    loadActualFiles(currNum).then(file_differences => {
        console.log('File differences loaded:', file_differences);
        displayFileRepository(file_differences);
    }).catch(error => {
        console.error('Error loading files:', error);
        const repoContent = $('#repoContent');
        if (repoContent) {
            repoContent.innerHTML = '<div class="alert alert-warning">Error loading files: ' + error.message + '</div>';
        }
    });
    
}

function displayFileRepository(files) {
    const repoContent = $('#repoContent');
    if (!repoContent) {
        console.log('Repo content element not found');
        return;
    }
    
    if (files.length === 0) {
        repoContent.innerHTML = '<div class="alert alert-info">No files found to compare</div>';
        return;
    }
    
    // Display VS Code-like file explorer
    const filesHtml = `
        <div class="file-explorer">
            <div class="file-sidebar">
                <h4>Files (${files.length})</h4>
                <div class="file-tree">
                    ${files.map(file => {
                        let icon = '📄';
                        let statusClass = '';
                        
                        if (file.isAdded) {
                            icon = '➕';
                            statusClass = 'file-added';
                        } else if (file.isRemoved) {
                            icon = '➖';
                            statusClass = 'file-removed';
                        } else if (file.hasChanges) {
                            icon = '📝';
                            statusClass = 'file-changed';
                        } else {
                            icon = '📄';
                            statusClass = 'file-unchanged';
                        }
                        
                        return `
                            <div class="file-item ${statusClass}" data-path="${escapeHtml(file.filename)}">
                                <span class="file-icon">${icon}</span>
                                <div class="file-info">
                                    <span class="file-name">${escapeHtml(file.filename.split('/').pop())}</span>
                                    <span class="file-folders">
                                        ${file.original ? `📁 ${file.original.folder}` : ''}
                                        ${file.original && file.modified ? ' ↔ ' : ''}
                                        ${file.modified ? `📁 ${file.modified.folder}` : ''}
                                    </span>
                                </div>
                                <span class="file-status">${file.isAdded ? 'Added' : file.isRemoved ? 'Removed' : file.hasChanges ? 'Modified' : 'Unchanged'}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            <div class="file-content-area">
                <div class="file-header">
                    <span class="file-title">Select a file to view differences</span>
                </div>
                <div class="file-diff-view">
                    <div class="diff-placeholder">
                        Click on a file in the sidebar to view its differences
                    </div>
                </div>
            </div>
        </div>
    `;
    
    repoContent.innerHTML = filesHtml;
    
    // Store files data globally for access in showFileDiff
    window.currentFiles = files;
    
    // Add event listeners for file selection - this uses the existing showFileDiff function
    const fileItems = repoContent.querySelectorAll('.file-item');
    fileItems.forEach(item => {
        item.addEventListener('click', () => {
            const filePath = item.dataset.path;
            const file = files.find(f => f.filename === filePath);
            if (file) {
                showFileDiff(file);
            }
        });
    });
}

async function loadActualFiles(exampleNum) {
    // Try to read actual files from the selected folder structure
    const files = [];
    
    try {
        // Get the files that were selected in the folder input
        const folderInput = $('#folderInput');
        if (!folderInput.files || folderInput.files.length === 0) {
            console.log('No files in folder input');
            return [];
        }
        
        const exampleFiles = Array.from(folderInput.files).filter(file => 
            file.webkitRelativePath.includes(`example_${exampleNum}/`)
        );
        
        console.log(`Files for example_${exampleNum}:`, exampleFiles.map(f => f.webkitRelativePath));
        
        if (exampleFiles.length === 0) {
            console.log(`No files found for example_${exampleNum}`);
            return [];
        }
        
        // Find all files in the original and modified directories
        // const originalDir = `example_${exampleNum}/files_${exampleNum}/`;
        // const modifiedDir = `example_${exampleNum}/without_oversight/`;
        const modifiedDir = `example_${exampleNum}/files_${exampleNum}/`;
        const originalDir = `example_${exampleNum}/without_oversight/`;
        
        console.log('Looking for original files in:', originalDir);
        console.log('Looking for modified files in:', modifiedDir);
        
        // Get all files in both directories (including subdirectories)
        const originalFiles = exampleFiles.filter(file => 
            file.webkitRelativePath.includes(originalDir)
        );
        const modifiedFiles = exampleFiles.filter(file => 
            file.webkitRelativePath.includes(modifiedDir)
        );
        
        console.log('Original files found:', originalFiles.map(f => f.webkitRelativePath));
        console.log('Modified files found:', modifiedFiles.map(f => f.webkitRelativePath));
        
        // Create a map of relative paths within each directory
        const originalMap = new Map();
        const modifiedMap = new Map();
        
        originalFiles.forEach(file => {
            // Find the position of the originalDir in the full path and extract relative path
            const dirIndex = file.webkitRelativePath.indexOf(originalDir);
            if (dirIndex !== -1) {
                const relativePath = file.webkitRelativePath.substring(dirIndex + originalDir.length);
                originalMap.set(relativePath, file);
            }
        });
        
        modifiedFiles.forEach(file => {
            // Find the position of the modifiedDir in the full path and extract relative path
            const dirIndex = file.webkitRelativePath.indexOf(modifiedDir);
            if (dirIndex !== -1) {
                const relativePath = file.webkitRelativePath.substring(dirIndex + modifiedDir.length);
                modifiedMap.set(relativePath, file);
            }
        });
        
        // Find files that exist in both directories
        const commonFiles = new Set([...originalMap.keys(), ...modifiedMap.keys()]);
        
        console.log('Common files to compare:', Array.from(commonFiles));
        
        // Compare files that exist in both directories
        for (const relativePath of commonFiles) {
            const originalFile = originalMap.get(relativePath);
            const modifiedFile = modifiedMap.get(relativePath);
            
            if (originalFile && modifiedFile) {
                try {
                    // Read file contents once
                    const originalContent = await readFileAsText(originalFile);
                    const modifiedContent = await readFileAsText(modifiedFile);
                    
                    const hasChanges = originalContent !== modifiedContent;
                    console.log(`File ${relativePath}: hasChanges=${hasChanges}, originalLength=${originalContent.length}, modifiedLength=${modifiedContent.length}`);
                    
                    files.push({
                        filename: relativePath,
                        original: {
                            content: originalContent,
                            folder: 'files_' + exampleNum
                        },
                        modified: {
                            content: modifiedContent,
                            folder: 'without_oversight'
                        },
                        hasChanges: hasChanges,
                        isAdded: false,
                        isRemoved: false
                    });
                } catch (error) {
                    console.warn(`Error reading files for ${relativePath}:`, error);
                }
            } else if (originalFile || modifiedFile) {
                // File exists in only one directory - show as added/removed
                const file = originalFile || modifiedFile;
                const content = await readFileAsText(file);
                const isAdded = !originalFile;
                
                files.push({
                    filename: relativePath,
                    original: isAdded ? null : { 
                        content: content,
                        folder: 'files_' + exampleNum
                    },
                    modified: isAdded ? { 
                        content: content,
                        folder: 'without_oversight'
                    } : null,
                    hasChanges: true,
                    isAdded: isAdded,
                    isRemoved: !isAdded
                });
            }
        }
        
        console.log(`Found ${files.length} files to compare`);
        return files;
        
    } catch (error) {
        console.error('Error loading actual files:', error);
        return [];
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsText(file);
    });
}

function showClearConfirmation() {
    // Create a confirmation dialog in the UI
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #e53e3e;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        max-width: 400px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0; color: #1a202c;">Clear All Progress?</h3>
        <p style="margin: 0 0 16px 0; color: #4a5568; font-size: 14px;">This will delete all annotations and cannot be undone.</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancelClear" style="padding: 8px 16px; border: 1px solid #e2e8f0; background: white; border-radius: 4px; cursor: pointer; font-size: 14px;">Cancel</button>
            <button id="confirmClear" style="padding: 8px 16px; border: 1px solid #e53e3e; background: #e53e3e; color: white; border-radius: 4px; cursor: pointer; font-size: 14px;">Clear All</button>
        </div>
    `;
    
    // Add backdrop
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.3);
        z-index: 999;
    `;
    
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    
    // Event listeners
    document.getElementById('cancelClear').addEventListener('click', () => {
        document.body.removeChild(backdrop);
        document.body.removeChild(dialog);
    });
    
    document.getElementById('confirmClear').addEventListener('click', () => {
        state.annotations = {};
        state.sessionId = null;
        localStorage.removeItem('scheming_annotations_progress');
        updateStatus();
        displayFileList();
        showStatus('info', 'All progress cleared.');
        document.body.removeChild(backdrop);
        document.body.removeChild(dialog);
    });
    
    // Close on backdrop click
    backdrop.addEventListener('click', () => {
        document.body.removeChild(backdrop);
        document.body.removeChild(dialog);
    });
}

function exportAnnotations() {
    if (Object.keys(state.annotations).length === 0) {
        showStatus('warning', 'No annotations to export.');
        return;
    }
    
    // Update time for current file before export
    updateFileTime();
    
    const exportData = {
        export_timestamp: new Date().toISOString(),
        session_id: state.sessionId,
        total_files: state.files.length,
        annotated_files: Object.keys(state.annotations).length,
        annotations: state.annotations
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheming_annotations_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('success', 'Annotations exported successfully!');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.removeHighlight = removeHighlight;

function showFileDiff(file) {
    const fileHeader = document.querySelector('.file-header .file-title');
    const diffView = document.querySelector('.file-diff-view');
    
    if (!fileHeader || !diffView) return;
    
    // Update header with status
    let statusIcon = '📄';
    if (file.isAdded) statusIcon = '➕';
    else if (file.isRemoved) statusIcon = '➖';
    else if (file.hasChanges) statusIcon = '📝';
    
    let folderInfo = '';
    if (file.original && file.modified) {
        folderInfo = ` (${file.original.folder} ↔ ${file.modified.folder})`;
    } else if (file.original) {
        folderInfo = ` (${file.original.folder})`;
    } else if (file.modified) {
        folderInfo = ` (${file.modified.folder})`;
    }
    
    fileHeader.textContent = `${statusIcon} ${file.filename}${folderInfo}`;
    
    let diffHtml = '<div class="diff-container">';
    
    if (file.isAdded) {
        // File was added
        const lines = file.modified.content.split('\n');
        diffHtml += `<div class="diff-header">➕ File Added (from ${file.modified.folder})</div>`;
        lines.forEach((line, i) => {
            diffHtml += `
                <div class="diff-line diff-added">
                    <div class="line-number">${i + 1}</div>
                    <div class="line-content">
                        <div class="added-line">${escapeHtml(line)}</div>
                    </div>
                </div>
            `;
        });
    } else if (file.isRemoved) {
        // File was removed
        const lines = file.original.content.split('\n');
        diffHtml += `<div class="diff-header">➖ File Removed (from ${file.original.folder})</div>`;
        lines.forEach((line, i) => {
            diffHtml += `
                <div class="diff-line diff-removed">
                    <div class="line-number">${i + 1}</div>
                    <div class="line-content">
                        <div class="removed-line">${escapeHtml(line)}</div>
                    </div>
                </div>
            `;
        });
    } else if (file.hasChanges) {
        // File was modified
        const originalLines = file.original.content.split('\n');
        const modifiedLines = file.modified.content.split('\n');
        const maxLines = Math.max(originalLines.length, modifiedLines.length);
        
        diffHtml += `<div class="diff-header">📝 File Modified (${file.original.folder} → ${file.modified.folder})</div>`;
        
        for (let i = 0; i < maxLines; i++) {
            const originalLine = originalLines[i] || '';
            const modifiedLine = modifiedLines[i] || '';
            const isDifferent = originalLine !== modifiedLine;
            
            diffHtml += `
                <div class="diff-line ${isDifferent ? 'diff-changed' : ''}">
                    <div class="line-number">${i + 1}</div>
                    <div class="line-content">
                        <div class="original-line">${escapeHtml(originalLine)}</div>
                        ${isDifferent ? `<div class="modified-line">${escapeHtml(modifiedLine)}</div>` : ''}
                    </div>
                </div>
            `;
        }
    } else {
        // File unchanged
        const lines = file.original.content.split('\n');
        diffHtml += `<div class="diff-header">📄 File Unchanged (${file.original.folder} ↔ ${file.modified.folder})</div>`;
        lines.forEach((line, i) => {
            diffHtml += `
                <div class="diff-line">
                    <div class="line-number">${i + 1}</div>
                    <div class="line-content">
                        <div class="unchanged-line">${escapeHtml(line)}</div>
                    </div>
                </div>
            `;
        });
    }
    
    diffHtml += '</div>';
    diffView.innerHTML = diffHtml;
    
    // Update active file in sidebar
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-path="${file.filename}"]`)?.classList.add('active');
}

document.addEventListener('DOMContentLoaded', init);
