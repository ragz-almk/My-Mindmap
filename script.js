// script.js
const GRID_SIZE = 20;
const COLORS = ['#334155', '#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea'];

// --- STATE MANAGEMENT ---
let state = {
    nodes: [{ id: '1', x: 100, y: 100, text: 'Ide Utama', color: COLORS[1] }],
    edges: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    activeTool: 'select', // 'select' | 'connect'
    selectedNodeId: null,
    connectSourceId: null
};

let history = [];
let future = [];

// Interaction Refs
let isDraggingViewport = false;
let isDraggingNode = false;
let dragStart = { x: 0, y: 0, panX: 0, panY: 0, nodeX: 0, nodeY: 0, offsetX: 0, offsetY: 0 };
let initialPinchDist = null; // Untuk Pinch to Zoom

// DOM Elements
const container = document.getElementById('app-container');
const canvasLayer = document.getElementById('canvas-layer');
const bgGrid = document.getElementById('bg-grid');
const edgesLayer = document.getElementById('edges-layer');
const nodesLayer = document.getElementById('nodes-layer');
const connectMessage = document.getElementById('connect-message');
const nodeToolbar = document.getElementById('node-toolbar');

// Initialize Icons
lucide.createIcons();

// --- HELPER FUNCTIONS ---
const getNodeSize = (text) => {
    const MAX_W = 10 * GRID_SIZE; // Maksimal horizontal 10 grid (200px)
    const MAX_H = 7 * GRID_SIZE;  // Maksimal vertikal 7 grid (140px)
    const MIN_W = 120; // Minimal 6 grid
    const MIN_H = 60;  // Minimal 3 grid
    
    // Pisahkan berdasarkan baris baru jika user memakai Shift+Enter
    const lines = (text || '').split('\n');
    const longestLine = Math.max(...lines.map(l => l.length), 0);
    
    // Hitung estimasi lebar: ~8px per huruf + 30px padding
    const estimatedWidth = (longestLine * 8) + 30;
    let w = Math.min(MAX_W, Math.max(MIN_W, estimatedWidth));
    
    // Hitung total baris setelah teks memanjang (word-wrap)
    const totalLines = lines.reduce((acc, line) => {
        const wrapCount = Math.ceil(((line.length * 8) + 30) / MAX_W);
        return acc + (wrapCount || 1);
    }, 0);
    
    // Hitung estimasi tinggi: ~20px per baris + 40px padding
    const estimatedHeight = (totalLines * 20) + 40;
    let h = Math.min(MAX_H, Math.max(MIN_H, estimatedHeight));
    
    // Paskan ukuran agar tetap menempel rapi di grid
    return { width: snapToGrid(w), height: snapToGrid(h) };
};

const snapToGrid = (value) => Math.round(value / GRID_SIZE) * GRID_SIZE;

const getCanvasCoords = (clientX, clientY) => {
    const rect = container.getBoundingClientRect();
    return {
        x: (clientX - rect.left - state.pan.x) / state.zoom,
        y: (clientY - rect.top - state.pan.y) / state.zoom
    };
};

const commit = (newNodes, newEdges) => {
    history.push({ nodes: JSON.parse(JSON.stringify(state.nodes)), edges: JSON.parse(JSON.stringify(state.edges)) });
    if (history.length > 15) history.shift();
    future = [];
    state.nodes = newNodes;
    state.edges = newEdges;
    render();
};

const getOrthogonalPath = (source, target) => {
    if (!source || !target) return '';
    const sourceSize = getNodeSize(source.text);
    const targetSize = getNodeSize(target.text);
    
    const startX = source.x + sourceSize.width / 2;
    const startY = source.y + sourceSize.height / 2;
    const endX = target.x + targetSize.width / 2;
    const endY = target.y + targetSize.height / 2;
    const midX = snapToGrid((startX + endX) / 2);
    
    return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
};

// --- RENDER ENGINE ---
function render() {
    // Render Transform
    canvasLayer.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    bgGrid.style.backgroundSize = `${GRID_SIZE * state.zoom}px ${GRID_SIZE * state.zoom}px`;
    bgGrid.style.backgroundImage = `
        linear-gradient(to right, #475569 1px, transparent 1px),
        linear-gradient(to bottom, #475569 1px, transparent 1px)
    `;
    bgGrid.style.backgroundPosition = `${state.pan.x}px ${state.pan.y}px`;

    // Render Edges
    edgesLayer.innerHTML = state.edges.map(edge => {
        const source = state.nodes.find(n => n.id === edge.source);
        const target = state.nodes.find(n => n.id === edge.target);
        return `<path d="${getOrthogonalPath(source, target)}" fill="none" stroke="${source?.color || '#475569'}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" class="opacity-60"></path>`;
    }).join('');

    // Render Nodes
    nodesLayer.innerHTML = '';
    state.nodes.forEach(node => {
        const div = document.createElement('div');
        div.className = `node ${state.selectedNodeId === node.id ? 'selected' : ''} ${state.connectSourceId === node.id ? 'connecting' : ''}`;
        div.style.width = `${NODE_WIDTH}px`;
        div.style.height = `${NODE_HEIGHT}px`;
        div.style.transform = `translate(${node.x}px, ${node.y}px)`;
        div.style.backgroundColor = node.color;
        
       // Node Content
        if (state.selectedNodeId === node.id && state.activeTool === 'select') {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'node-input';
            input.value = node.text;
            input.onpointerdown = e => e.stopPropagation();
            
            // Mengupdate state secara langsung saat mengetik
            input.oninput = e => { node.text = e.target.value; }; 
            
            // --- FITUR BARU: Deteksi tombol Enter ---
            input.onkeydown = e => {
                if (e.key === 'Enter') {
                    input.blur(); // Memicu onblur untuk menyimpan (commit)
                }
            };

            input.onblur = () => commit(state.nodes, state.edges);
            div.appendChild(input);
            setTimeout(() => input.focus(), 10);
        } else {
            const span = document.createElement('span');
            span.className = 'text-white font-medium text-center px-2 pointer-events-none line-clamp-2 leading-tight';
            span.innerText = node.text;
            div.appendChild(span);
        }

        // --- PERBAIKAN BUG ---
        // Gunakan insertAdjacentHTML alih-alih innerHTML += agar event listener tidak hilang
        div.insertAdjacentHTML('beforeend', `<div class="node-port left"></div><div class="node-port right"></div>`);
        
        // Node Interaction
        div.onpointerdown = (e) => handleNodePointerDown(e, node);
        nodesLayer.appendChild(div);
    });

    // Update UI Elements
    connectMessage.classList.toggle('hidden', state.activeTool !== 'connect');
    if (state.activeTool === 'connect') {
        connectMessage.innerText = state.connectSourceId ? 'Tap kotak kedua untuk menyambung' : 'Tap kotak pertama';
    }

    nodeToolbar.classList.toggle('hidden', !(state.selectedNodeId && state.activeTool === 'select'));
    document.getElementById('btn-undo').disabled = history.length === 0;
    document.getElementById('btn-redo').disabled = future.length === 0;
    
    document.getElementById('btn-select').className = `p-3 rounded-xl transition-colors ${state.activeTool === 'select' ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-700'}`;
    document.getElementById('btn-connect').className = `p-3 rounded-xl transition-colors ${state.activeTool === 'connect' ? 'bg-yellow-600 text-white' : 'text-slate-200 hover:bg-slate-700'}`;
}

// --- INTERACTION LOGIC ---
function handleNodePointerDown(e, node) {
    e.stopPropagation();
    if (state.activeTool === 'connect') {
        if (!state.connectSourceId) {
            state.connectSourceId = node.id;
        } else if (state.connectSourceId !== node.id) {
            const exists = state.edges.some(edge => 
                (edge.source === state.connectSourceId && edge.target === node.id) ||
                (edge.target === state.connectSourceId && edge.source === node.id)
            );
            if (!exists) {
                commit(state.nodes, [...state.edges, { id: Date.now().toString(), source: state.connectSourceId, target: node.id }]);
            }
            state.connectSourceId = null;
        }
    } else {
        state.selectedNodeId = node.id;
        const coords = getCanvasCoords(e.clientX, e.clientY);
        isDraggingNode = true;
        dragStart = { offsetX: coords.x - node.x, offsetY: coords.y - node.y, nodeX: node.x, nodeY: node.y };
    }
    render();
}

container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('#node-toolbar') || e.target.closest('.node')) return;
    isDraggingViewport = true;
    dragStart = { x: e.clientX, y: e.clientY, panX: state.pan.x, panY: state.pan.y };
    state.selectedNodeId = null;
    state.connectSourceId = null;
    render();
});

container.addEventListener('pointermove', (e) => {
    if (isDraggingViewport) {
        state.pan.x = dragStart.panX + (e.clientX - dragStart.x);
        state.pan.y = dragStart.panY + (e.clientY - dragStart.y);
        render();
    } else if (isDraggingNode && state.selectedNodeId && state.activeTool === 'select') {
        const coords = getCanvasCoords(e.clientX, e.clientY);
        const newX = snapToGrid(coords.x - dragStart.offsetX);
        const newY = snapToGrid(coords.y - dragStart.offsetY);
        const node = state.nodes.find(n => n.id === state.selectedNodeId);
        if (node) { node.x = newX; node.y = newY; render(); }
    }
});

const endDrag = () => {
    if (isDraggingNode) {
        const node = state.nodes.find(n => n.id === state.selectedNodeId);
        if (node && (node.x !== dragStart.nodeX || node.y !== dragStart.nodeY)) {
            // Restore position to save history, then apply new
            const finalX = node.x; const finalY = node.y;
            node.x = dragStart.nodeX; node.y = dragStart.nodeY;
            commit(state.nodes, state.edges);
            node.x = finalX; node.y = finalY;
            render();
        }
    }
    isDraggingViewport = false;
    isDraggingNode = false;
};

container.addEventListener('pointerup', endDrag);
container.addEventListener('pointerleave', endDrag);

// --- NEW FEATURES: ZOOMING ---

// Scroll for PC Zoom
container.addEventListener('wheel', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('#node-toolbar')) return;
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
    state.zoom = Math.max(0.3, Math.min(2.5, state.zoom + zoomDelta));
    render();
}, { passive: false });

// Scroll for PC Zoom (Zoom to Cursor)
container.addEventListener('wheel', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('#node-toolbar')) return;
    e.preventDefault();

    // 1. Tentukan nilai zoom yang baru
    const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.3, Math.min(2.5, state.zoom + zoomDelta));

    // Jika nilai zoom sudah mentok di batas maksimal/minimal, hentikan fungsi
    if (newZoom === state.zoom) return;

    // 2. Dapatkan posisi kursor mouse relatif terhadap container
    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // 3. Hitung koordinat kanvas aktual di bawah kursor (sebelum zoom)
    const canvasX = (cursorX - state.pan.x) / state.zoom;
    const canvasY = (cursorY - state.pan.y) / state.zoom;

    // 4. Terapkan nilai zoom yang baru
    state.zoom = newZoom;

    // 5. Sesuaikan ulang posisi pan (geser) agar kursor tetap menunjuk titik kanvas yang sama
    state.pan.x = cursorX - (canvasX * state.zoom);
    state.pan.y = cursorY - (canvasY * state.zoom);

    render();
}, { passive: false });

// Pinch for Mobile Zoom
container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        isDraggingViewport = false; // Batalkan pan jika mulai pinch
        initialPinchDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
    }
}, { passive: false });

container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialPinchDist) {
        e.preventDefault();
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        const scaleChange = dist / initialPinchDist;
        state.zoom = Math.max(0.3, Math.min(2.5, state.zoom * scaleChange));
        initialPinchDist = dist; // update untuk gerakan kontinyu
        render();
    }
}, { passive: false });

container.addEventListener('touchend', () => { initialPinchDist = null; });

// --- BUTTON LISTENERS ---
document.getElementById('btn-add').onclick = () => {
    const viewportCenterX = -state.pan.x / state.zoom + window.innerWidth / (2 * state.zoom);
    const viewportCenterY = -state.pan.y / state.zoom + window.innerHeight / (2 * state.zoom);
    const newNode = {
        id: Date.now().toString(),
        x: snapToGrid(viewportCenterX - 120 / 2),
        y: snapToGrid(viewportCenterY - 60 / 2),
        text: 'Kotak Baru',
        color: COLORS[0]
    };
    commit([...state.nodes, newNode], state.edges);
    state.selectedNodeId = newNode.id;
    state.activeTool = 'select';
    render();
};

document.getElementById('btn-select').onclick = () => { state.activeTool = 'select'; render(); };
document.getElementById('btn-connect').onclick = () => { state.activeTool = 'connect'; state.selectedNodeId = null; state.connectSourceId = null; render(); };

document.getElementById('btn-undo').onclick = () => {
    if (history.length === 0) return;
    const prev = history.pop();
    future.push({ nodes: JSON.parse(JSON.stringify(state.nodes)), edges: JSON.parse(JSON.stringify(state.edges)) });
    state.nodes = prev.nodes; state.edges = prev.edges;
    state.selectedNodeId = null;
    render();
};

document.getElementById('btn-redo').onclick = () => {
    if (future.length === 0) return;
    const nxt = future.pop();
    history.push({ nodes: JSON.parse(JSON.stringify(state.nodes)), edges: JSON.parse(JSON.stringify(state.edges)) });
    state.nodes = nxt.nodes; state.edges = nxt.edges;
    state.selectedNodeId = null;
    render();
};

document.getElementById('btn-zoom-in').onclick = () => { state.zoom = Math.min(2.5, state.zoom + 0.2); render(); };
document.getElementById('btn-zoom-out').onclick = () => { state.zoom = Math.max(0.3, state.zoom - 0.2); render(); };

document.getElementById('btn-delete').onclick = () => {
    if (!state.selectedNodeId) return;
    commit(
        state.nodes.filter(n => n.id !== state.selectedNodeId),
        state.edges.filter(e => e.source !== state.selectedNodeId && e.target !== state.selectedNodeId)
    );
    state.selectedNodeId = null;
    render();
};

// Setup Color Picker
const colorContainer = document.getElementById('color-picker');
COLORS.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'w-6 h-6 rounded-full border-2 border-transparent hover:border-white transition-all focus:outline-none';
    btn.style.backgroundColor = color;
    btn.onclick = () => {
        if (!state.selectedNodeId) return;
        const newNodes = state.nodes.map(n => n.id === state.selectedNodeId ? { ...n, color } : n);
        commit(newNodes, state.edges);
    };
    colorContainer.appendChild(btn);
});

// --- NEW FEATURES: DATA MANAGEMENT ---

// Save to LocalStorage
document.getElementById('btn-save').onclick = () => {
    localStorage.setItem('mindmap_cache', JSON.stringify({ nodes: state.nodes, edges: state.edges }));
    alert('Progress berhasil disimpan secara lokal!');
};

// Export to JSON
document.getElementById('btn-export').onclick = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ nodes: state.nodes, edges: state.edges }));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "mindmap_backup.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
};

// Import from JSON
document.getElementById('input-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (parsed.nodes && parsed.edges) {
                commit(parsed.nodes, parsed.edges);
                alert('Data berhasil dimuat!');
            }
        } catch (err) {
            alert('File JSON tidak valid.');
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset input
};

// Load Cache on Startup
function loadCache() {
    const cached = localStorage.getItem('mindmap_cache');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            state.nodes = parsed.nodes;
            state.edges = parsed.edges;
        } catch(e) { console.error("Gagal load cache"); }
    }
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log('Service Worker Registered'))
        .catch(err => console.error('SW Registration Failed', err));
}

// Init Application
loadCache();
render();
