// script.js
const GRID_SIZE = 20;
const COLORS = ['#334155', '#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea'];

// --- STATE MANAGEMENT ---
let state = {
    nodes: [{ id: '1', x: 100, y: 100, text: 'Ide Utama', color: COLORS[1] }],
    edges: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    activeTool: 'select', 
    selectedNodeIds: [], // Sekarang menggunakan array untuk multi-select
    connectSourceId: null
};

let history = [];
let future = [];

// Interaction Refs
let isDraggingViewport = false;
let isDraggingNode = false;
let isSelecting = false; // Deteksi apakah sedang membuat kotak seleksi
let dragStart = { x: 0, y: 0, panX: 0, panY: 0, startX: 0, startY: 0 };
let selectStart = { x: 0, y: 0 };
let dragOffsets = []; // Menyimpan posisi awal banyak kotak saat digeser
let initialPinchDist = null;

// DOM Elements
const container = document.getElementById('app-container');
const canvasLayer = document.getElementById('canvas-layer');
const bgGrid = document.getElementById('bg-grid');
const edgesLayer = document.getElementById('edges-layer');
const nodesLayer = document.getElementById('nodes-layer');
const connectMessage = document.getElementById('connect-message');
const nodeToolbar = document.getElementById('node-toolbar');

// --- FITUR BARU: Elemen Visual Kotak Seleksi ---
const selectionBoxEl = document.createElement('div');
selectionBoxEl.style.cssText = 'position: absolute; border: 1px solid #3b82f6; background-color: rgba(59, 130, 246, 0.2); pointer-events: none; display: none; z-index: 100;';
document.body.appendChild(selectionBoxEl);

// Mencegah menu klik kanan muncul agar tidak mengganggu
container.addEventListener('contextmenu', e => e.preventDefault());

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
    // Simpan ke history untuk Undo/Redo
    history.push({ nodes: JSON.parse(JSON.stringify(state.nodes)), edges: JSON.parse(JSON.stringify(state.edges)) });
    if (history.length > 15) history.shift();
    future = [];
    
    // Perbarui state
    state.nodes = newNodes;
    state.edges = newEdges;
    
    // --- FITUR AUTO-SAVE ---
    // Otomatis simpan ke Local Storage setiap ada perubahan
    localStorage.setItem('mindmap_cache', JSON.stringify({ nodes: state.nodes, edges: state.edges }));
    
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
        const size = getNodeSize(node.text);
        
        // Cek apakah node ini termasuk yang sedang dipilih
        const isSelected = state.selectedNodeIds.includes(node.id);

        const div = document.createElement('div');
        div.className = `node ${isSelected ? 'selected' : ''} ${state.connectSourceId === node.id ? 'connecting' : ''}`;
        div.style.width = `${size.width}px`;
        div.style.height = `${size.height}px`;
        div.style.transform = `translate(${node.x}px, ${node.y}px)`;
        div.style.backgroundColor = node.color;
        
        // Node Content (Hanya bisa edit text jika yang dipilih HANYA 1 kotak)
        if (isSelected && state.selectedNodeIds.length === 1 && state.activeTool === 'select') {
            const input = document.createElement('textarea'); 
            input.className = 'node-input';
            
            input.style.width = '100%';
            input.style.height = '100%';
            input.style.resize = 'none';
            input.style.background = 'transparent';
            input.style.border = 'none';
            input.style.color = 'white';
            input.style.textAlign = 'center';
            input.style.outline = 'none';
            input.style.overflow = 'hidden';
            
            input.value = node.text;
            input.onpointerdown = e => e.stopPropagation();
            
            input.oninput = e => { 
                node.text = e.target.value; 
                const newSize = getNodeSize(node.text);
                div.style.width = `${newSize.width}px`;
                div.style.height = `${newSize.height}px`;
                
                edgesLayer.innerHTML = state.edges.map(edge => {
                    const source = state.nodes.find(n => n.id === edge.source);
                    const target = state.nodes.find(n => n.id === edge.target);
                    return `<path d="${getOrthogonalPath(source, target)}" fill="none" stroke="${source?.color || '#475569'}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" class="opacity-60"></path>`;
                }).join('');
            }; 
            
            input.onkeydown = e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    input.blur(); 
                }
            };

            input.onblur = () => commit(state.nodes, state.edges);
            div.appendChild(input);
            setTimeout(() => {
                input.focus();
                input.selectionStart = input.selectionEnd = input.value.length; 
            }, 10);
        } else {
            const span = document.createElement('span');
            span.className = 'text-white font-medium text-center px-2 pointer-events-none leading-tight';
            span.style.whiteSpace = 'pre-wrap';
            span.style.wordBreak = 'break-word';
            span.style.display = '-webkit-box';
            span.style.webkitLineClamp = '7'; 
            span.style.webkitBoxOrient = 'vertical';
            span.style.overflow = 'hidden';
            span.innerText = node.text;
            div.appendChild(span);
        }

        // Ports
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

    // Tampilkan toolbar hanya jika ada kotak yang dipilih
    nodeToolbar.classList.toggle('hidden', !(state.selectedNodeIds.length > 0 && state.activeTool === 'select'));
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
        if (e.button === 0) { // Klik kiri
            // Jika kotak yang diklik belum termasuk dalam seleksi, jadikan kotak ini seleksi utama
            if (!state.selectedNodeIds.includes(node.id)) {
                state.selectedNodeIds = [node.id];
            }
            
            const coords = getCanvasCoords(e.clientX, e.clientY);
            isDraggingNode = true;
            dragStart = { startX: coords.x, startY: coords.y };
            
            // Simpan posisi mula-mula dari SEMUA kotak yang terseleksi
            dragOffsets = state.selectedNodeIds.map(id => {
                const n = state.nodes.find(n => n.id === id);
                return { id: id, nodeStartX: n.x, nodeStartY: n.y };
            });
        }
    }
    render();
}

container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('#node-toolbar') || e.target.closest('.node')) return;
    
    if (e.button === 1) { 
        // KLIK TENGAH (Scroll Wheel): Untuk Pan Layar
        e.preventDefault();
        isDraggingViewport = true;
        dragStart = { x: e.clientX, y: e.clientY, panX: state.pan.x, panY: state.pan.y };
    } else if (e.button === 0 && state.activeTool === 'select') { 
        // KLIK KIRI (Tahan): Untuk Drag Select (Marquee)
        isSelecting = true;
        selectStart = { x: e.clientX, y: e.clientY };
        selectionBoxEl.style.display = 'block';
        selectionBoxEl.style.left = e.clientX + 'px';
        selectionBoxEl.style.top = e.clientY + 'px';
        selectionBoxEl.style.width = '0px';
        selectionBoxEl.style.height = '0px';
        
        state.selectedNodeIds = []; // Reset seleksi saat klik background
    }
    
    state.connectSourceId = null;
    render();
});

container.addEventListener('pointermove', (e) => {
    if (isDraggingViewport) {
        state.pan.x = dragStart.panX + (e.clientX - dragStart.x);
        state.pan.y = dragStart.panY + (e.clientY - dragStart.y);
        render();
    } else if (isSelecting) {
        // Logika menggambar kotak seleksi biru
        const currentX = e.clientX;
        const currentY = e.clientY;
        const left = Math.min(selectStart.x, currentX);
        const top = Math.min(selectStart.y, currentY);
        const width = Math.abs(currentX - selectStart.x);
        const height = Math.abs(currentY - selectStart.y);
        
        selectionBoxEl.style.left = left + 'px';
        selectionBoxEl.style.top = top + 'px';
        selectionBoxEl.style.width = width + 'px';
        selectionBoxEl.style.height = height + 'px';

        // Hitung kotak mana saja yang tersentuh area seleksi
        const startCanvas = getCanvasCoords(left, top);
        const endCanvas = getCanvasCoords(left + width, top + height);

        state.selectedNodeIds = state.nodes.filter(node => {
            const size = getNodeSize(node.text);
            return (
                node.x + size.width > startCanvas.x &&
                node.x < endCanvas.x &&
                node.y + size.height > startCanvas.y &&
                node.y < endCanvas.y
            );
        }).map(n => n.id);

        render();
    } else if (isDraggingNode && state.activeTool === 'select') {
        // Menggeser semua kotak yang terseleksi
        const coords = getCanvasCoords(e.clientX, e.clientY);
        const deltaX = snapToGrid(coords.x - dragStart.startX);
        const deltaY = snapToGrid(coords.y - dragStart.startY);

        dragOffsets.forEach(item => {
            const node = state.nodes.find(n => n.id === item.id);
            if (node) {
                node.x = item.nodeStartX + deltaX;
                node.y = item.nodeStartY + deltaY;
            }
        });
        render();
    }
});

const endDrag = () => {
    if (isDraggingNode) {
        // Cek apakah posisi benar-benar berubah untuk disimpan di history
        const changed = dragOffsets.some(item => {
            const node = state.nodes.find(n => n.id === item.id);
            return node && (node.x !== item.nodeStartX || node.y !== item.nodeStartY);
        });

        if (changed) {
            const currentPositions = dragOffsets.map(item => {
                const node = state.nodes.find(n => n.id === item.id);
                return { id: item.id, x: node.x, y: node.y };
            });

            // Kembalikan sementara ke awal, commit, lalu taruh di posisi baru
            dragOffsets.forEach(item => {
                const node = state.nodes.find(n => n.id === item.id);
                if (node) { node.x = item.nodeStartX; node.y = item.nodeStartY; }
            });
            commit(state.nodes, state.edges);

            currentPositions.forEach(pos => {
                const node = state.nodes.find(n => n.id === pos.id);
                if (node) { node.x = pos.x; node.y = pos.y; }
            });
            render();
        }
    }

    if (isSelecting) selectionBoxEl.style.display = 'none';

    isDraggingViewport = false;
    isDraggingNode = false;
    isSelecting = false;
};

container.addEventListener('pointerup', endDrag);
container.addEventListener('pointerleave', endDrag);

// --- NEW FEATURES: ZOOMING ---
// Scroll for PC Zoom (Zoom to Cursor)
container.addEventListener('wheel', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('#node-toolbar')) return;
    e.preventDefault();

    // 1. Tentukan nilai zoom yang baru
    const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.3, Math.min(2.5, state.zoom + zoomDelta));

    if (newZoom === state.zoom) return;

    // 2. Dapatkan posisi kursor mouse
    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // 3. Hitung koordinat kanvas aktual
    const canvasX = (cursorX - state.pan.x) / state.zoom;
    const canvasY = (cursorY - state.pan.y) / state.zoom;

    // 4. Terapkan nilai zoom
    state.zoom = newZoom;

    // 5. Sesuaikan pan
    state.pan.x = cursorX - (canvasX * state.zoom);
    state.pan.y = cursorY - (canvasY * state.zoom);

    render();
}, { passive: false });

// Pinch for Mobile Zoom
// --- NEW FEATURES: ZOOMING ---

// Scroll for PC Zoom (Zoom to Cursor)
// ... (Biarkan bagian event 'wheel' PC tidak diubah) ...

// --- MOBILE TOUCH (PAN & ZOOM 2 JARI) ---
let initialPinchCenter = null; // Variabel baru untuk menyimpan titik tengah 2 jari

container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault(); // Mencegah layar browser ikut ter-scroll
        
        // Batalkan mode seleksi kotak (marquee) jika user pakai 2 jari
        isSelecting = false; 
        selectionBoxEl.style.display = 'none';

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        
        // Simpan jarak awal dan titik tengah awal
        initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialPinchCenter = {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2
        };
    }
}, { passive: false });

container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialPinchDist && initialPinchCenter) {
        e.preventDefault();
        
        const t1 = e.touches[0];
        const t2 = e.touches[1];

        // 1. Hitung jarak dan titik tengah yang BARU
        const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const newCenter = {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2
        };

        // 2. Lakukan Geser (Pan) berdasarkan pergerakan titik tengah jari
        const deltaX = newCenter.x - initialPinchCenter.x;
        const deltaY = newCenter.y - initialPinchCenter.y;
        state.pan.x += deltaX;
        state.pan.y += deltaY;

        // 3. Lakukan Zoom (Terpusat di titik tengah jari)
        const scaleChange = newDist / initialPinchDist;
        const oldZoom = state.zoom;
        const newZoom = Math.max(0.3, Math.min(2.5, state.zoom * scaleChange));
        
        if (newZoom !== oldZoom) {
            const rect = container.getBoundingClientRect();
            const cursorX = newCenter.x - rect.left;
            const cursorY = newCenter.y - rect.top;
            
            // Hitung posisi kanvas sebelum zoom
            const canvasX = (cursorX - state.pan.x) / oldZoom;
            const canvasY = (cursorY - state.pan.y) / oldZoom;

            state.zoom = newZoom;

            // Sesuaikan geseran agar zoom tidak melompat
            state.pan.x = cursorX - (canvasX * state.zoom);
            state.pan.y = cursorY - (canvasY * state.zoom);
        }

        // 4. Update data untuk gerakan (frame) selanjutnya
        initialPinchDist = newDist;
        initialPinchCenter = newCenter;
        
        render();
    }
}, { passive: false });

container.addEventListener('touchend', (e) => { 
    // Jika jari yang menempel kurang dari 2, hentikan proses pan/zoom
    if (e.touches.length < 2) {
        initialPinchDist = null; 
        initialPinchCenter = null;
    }
});

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
    state.selectedNodeIds = [newNode.id];
    state.activeTool = 'select';
    render();
};

document.getElementById('btn-select').onclick = () => { state.activeTool = 'select'; render(); };
document.getElementById('btn-connect').onclick = () => { state.activeTool = 'connect'; state.selectedNodeIds = []; state.connectSourceId = null; render(); };

document.getElementById('btn-undo').onclick = () => {
    if (history.length === 0) return;
    const prev = history.pop();
    future.push({ nodes: JSON.parse(JSON.stringify(state.nodes)), edges: JSON.parse(JSON.stringify(state.edges)) });
    state.nodes = prev.nodes; state.edges = prev.edges;
    state.selectedNodeIds = [];
    render();
};

document.getElementById('btn-redo').onclick = () => {
    if (future.length === 0) return;
    const nxt = future.pop();
    history.push({ nodes: JSON.parse(JSON.stringify(state.nodes)), edges: JSON.parse(JSON.stringify(state.edges)) });
    state.nodes = nxt.nodes; state.edges = nxt.edges;
    state.selectedNodeIds = [];
    render();
};

document.getElementById('btn-zoom-in').onclick = () => { state.zoom = Math.min(2.5, state.zoom + 0.2); render(); };
document.getElementById('btn-zoom-out').onclick = () => { state.zoom = Math.max(0.3, state.zoom - 0.2); render(); };

document.getElementById('btn-delete').onclick = () => {
    if (state.selectedNodeIds.length === 0) return;
    commit(
        state.nodes.filter(n => !state.selectedNodeIds.includes(n.id)),
        state.edges.filter(e => !state.selectedNodeIds.includes(e.source) && !state.selectedNodeIds.includes(e.target))
    );
    state.selectedNodeIds = [];
    render();
};

// Setup Color Picker
const colorContainer = document.getElementById('color-picker');
colorContainer.innerHTML = ''; 
COLORS.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'w-6 h-6 rounded-full border-2 border-transparent hover:border-white transition-all focus:outline-none';
    btn.style.backgroundColor = color;
    btn.onclick = () => {
        if (state.selectedNodeIds.length === 0) return;
        const newNodes = state.nodes.map(n => state.selectedNodeIds.includes(n.id) ? { ...n, color } : n);
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

// --- KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', (e) => {
    // Abaikan shortcut jika user sedang mengetik teks di dalam kotak
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    // Shortcut kombinasi Ctrl (atau Cmd di Mac)
    if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
            e.preventDefault(); // Mencegah aksi bawaan browser
            if (e.shiftKey) {
                document.getElementById('btn-redo').click(); // Ctrl + Shift + Z (Redo)
            } else {
                document.getElementById('btn-undo').click(); // Ctrl + Z (Undo)
            }
            return;
        }
        if (e.key.toLowerCase() === 'y') {
            e.preventDefault();
            document.getElementById('btn-redo').click(); // Ctrl + Y (Redo)
            return;
        }
    }

    // Shortcut satu huruf
    switch (e.key.toLowerCase()) {
        case 'v': // Mode Pilih
            document.getElementById('btn-select').click();
            break;
        case 'c': // Mode Sambung (Bisa juga pakai 'c' untuk Connect jika mau)
            document.getElementById('btn-connect').click();
            break;
        case 'a': // Tambah Kotak
            document.getElementById('btn-add').click();
            break;
        case 'delete': // Hapus Kotak
        case 'backspace':
            document.getElementById('btn-delete').click();
            break;
        case '+': // Zoom In (kadang di keyboard tombol + itu sama dengan =)
        case '=':
            document.getElementById('btn-zoom-in').click();
            break;
        case '-': // Zoom Out
            document.getElementById('btn-zoom-out').click();
            break;
    }
});

// --- AUTO-SAVE SAFETY NET ---
// Menyimpan data sepersekian detik sebelum tab ditutup atau di-refresh
window.addEventListener('beforeunload', () => {
    localStorage.setItem('mindmap_cache', JSON.stringify({ nodes: state.nodes, edges: state.edges }));
});

// Init Application
loadCache();
render();
