/* ============================================
   引っ越しプロジェクト管理ツール - アプリケーションロジック
   Firebase Firestore リアルタイム同期版
   ============================================ */

// ===== Firebase SDK (CDN) =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
    getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, setDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

// ===== Firebase設定 =====
const firebaseConfig = {
    apiKey: "AIzaSyCTt9C6sJffzOfcliNb7SF2RhhUvYJVRig",
    authDomain: "sayuri-hikkoshi.firebaseapp.com",
    projectId: "sayuri-hikkoshi",
    storageBucket: "sayuri-hikkoshi.firebasestorage.app",
    messagingSenderId: "659647793868",
    appId: "1:659647793868:web:fbb7cce33d8f0210731069"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ===== カテゴリマップ =====
const CATEGORIES = {
    housing: '🏠 住居関連',
    paperwork: '📋 届出・手続き',
    packing: '📦 荷造り・整理',
    utilities: '💡 ライフライン',
    finance: '💰 費用・契約',
    address: '📬 住所変更通知',
    other: '🔧 その他',
};

const PRIORITY_LABELS = {
    high: '🔴 高',
    medium: '🟡 中',
    low: '🟢 低',
};

// ===== ユーティリティ =====
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const wd = weekdays[d.getDay()];
    return `${month}/${day}（${wd}）`;
}

function formatCurrency(num) {
    return '¥' + Number(num).toLocaleString();
}

function isOverdue(dateStr) {
    if (!dateStr) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dateStr + 'T00:00:00') < today;
}

function isToday(dateStr) {
    if (!dateStr) return false;
    const today = new Date();
    const d = new Date(dateStr + 'T00:00:00');
    return today.getFullYear() === d.getFullYear() &&
        today.getMonth() === d.getMonth() &&
        today.getDate() === d.getDate();
}

function isPast(dateStr) {
    if (!dateStr) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dateStr + 'T00:00:00') < today;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== インメモリキャッシュ =====
let state = {
    movingDate: '2026-03-31',
    tasks: [],
    places: [],
    postTasks: [],
    notes: [],
    expenses: [],
};

// ===== カウントダウン =====
function updateCountdown() {
    const now = new Date();
    const target = new Date(state.movingDate + 'T00:00:00');
    const diff = target - now;

    if (diff <= 0) {
        document.getElementById('countdown-days').textContent = '0';
        document.getElementById('countdown-hours').textContent = '0';
        document.getElementById('countdown-minutes').textContent = '0';
        document.getElementById('countdown-seconds').textContent = '0';
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    document.getElementById('countdown-days').textContent = days;
    document.getElementById('countdown-hours').textContent = hours;
    document.getElementById('countdown-minutes').textContent = minutes;
    document.getElementById('countdown-seconds').textContent = seconds;
}

// ===== 進捗バー =====
function updateProgress() {
    const total = state.tasks.length;
    const done = state.tasks.filter(t => t.done).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    const bar = document.getElementById('overall-progress-bar');
    const text = document.getElementById('overall-progress-text');
    bar.style.width = Math.max(pct, 3) + '%';
    text.textContent = pct + '%';
}

// ===== タブ切り替え =====
function initTabs() {
    const savedTab = localStorage.getItem('hikkoshi_active_tab') || 'tasks';
    switchTab(savedTab);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
            localStorage.setItem('hikkoshi_active_tab', tab);
        });
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const panel = document.getElementById(`panel-${tabId}`);
    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');

    // 行く場所タブに切り替えた時、地図を初期化/更新
    if (tabId === 'places') {
        setTimeout(() => {
            if (!placesMap) {
                initPlacesMap();
            }
            if (placesMap) {
                placesMap.invalidateSize();
                updatePlacesMap();
            }
        }, 200);
    }
}

// ===== モーダル管理 =====
function showModal(id) {
    document.getElementById(id).classList.add('visible');
}

function hideModal(id) {
    document.getElementById(id).classList.remove('visible');
}

function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => hideModal(btn.dataset.close));
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) hideModal(overlay.id);
        });
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.visible').forEach(m => {
                hideModal(m.id);
            });
        }
    });
}

// =============================================
//  Firestore CRUD + リアルタイムリスナー
// =============================================

// ----- 設定 (引っ越し日) -----
async function loadSettings() {
    const docRef = doc(db, 'settings', 'general');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
        state.movingDate = snap.data().movingDate || '2026-03-31';
    }
    document.getElementById('moving-date-input').value = state.movingDate;
    updateCountdown();
}

async function saveMovingDate(dateVal) {
    state.movingDate = dateVal;
    await setDoc(doc(db, 'settings', 'general'), { movingDate: dateVal }, { merge: true });
    updateCountdown();
}

function initMovingDate() {
    document.getElementById('moving-date-input').value = state.movingDate;

    document.getElementById('save-date-btn').addEventListener('click', () => {
        const val = document.getElementById('moving-date-input').value;
        if (val) saveMovingDate(val);
    });

    // リアルタイムリスナーで他端末の変更も反映
    onSnapshot(doc(db, 'settings', 'general'), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            if (data.movingDate) {
                state.movingDate = data.movingDate;
                document.getElementById('moving-date-input').value = data.movingDate;
                updateCountdown();
            }
        }
    });
}

// ----- タスク -----
function initTasksListener() {
    const q = collection(db, 'tasks');
    onSnapshot(q, (snapshot) => {
        state.tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderTasks();
    });
}

function renderTasks() {
    const filterCat = document.getElementById('task-filter-category').value;
    let filtered = state.tasks;
    if (filterCat !== 'all') {
        filtered = filtered.filter(t => t.category === filterCat);
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (priorityOrder[a.priority] !== priorityOrder[b.priority])
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        if (a.due && b.due) return a.due.localeCompare(b.due);
        if (a.due) return -1;
        if (b.due) return 1;
        return 0;
    });

    const container = document.getElementById('task-list');

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📋</span>
                <p>${filterCat === 'all' ? 'まだタスクがありません。<br>「＋ タスク追加」ボタンから始めましょう！' : 'このカテゴリにはタスクがありません。'}</p>
            </div>`;
    } else {
        container.innerHTML = filtered.map(task => {
            const dueTxt = task.due ? formatDate(task.due) : '';
            const overdueClass = task.due && isOverdue(task.due) && !task.done ? ' overdue' : '';
            const memoHtml = task.memo ? `<div class="task-memo-text">${escapeHtml(task.memo)}</div>` : '';
            const urlHtml = task.url ? `<div class="task-url"><a href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗 ${escapeHtml(task.url.length > 40 ? task.url.substring(0, 40) + '…' : task.url)}</a></div>` : '';

            const subtasks = task.subtasks || [];
            const subtasksDone = subtasks.filter(s => s.done).length;
            const subtaskCountTag = subtasks.length > 0
                ? `<span class="task-tag subtask-count">📋 ${subtasksDone}/${subtasks.length}</span>`
                : '';

            const subtasksHtml = subtasks.map((st, i) => `
                <div class="subtask-item ${st.done ? 'done' : ''}">
                    <button class="subtask-checkbox ${st.done ? 'checked' : ''}" data-action="toggle-subtask" data-id="${task.id}" data-idx="${i}">
                        ${st.done ? '✓' : ''}
                    </button>
                    <span class="subtask-name">${escapeHtml(st.name)}</span>
                    <button class="btn-icon danger subtask-delete" data-action="delete-subtask" data-id="${task.id}" data-idx="${i}" title="削除">✕</button>
                </div>
            `).join('');

            const hasSubtasksClass = subtasks.length > 0 ? ' has-subtasks' : '';

            return `
            <div class="task-item ${task.done ? 'done' : ''}${hasSubtasksClass}" data-action="toggle-expand" data-id="${task.id}">
                <button class="task-checkbox ${task.done ? 'checked' : ''}" data-action="toggle-task" data-id="${task.id}">
                    ${task.done ? '✓' : ''}
                </button>
                <div class="task-item-content">
                    <div class="task-item-name">${escapeHtml(task.name)}</div>
                    <div class="task-item-meta">
                        <span class="task-tag">${CATEGORIES[task.category] || task.category}</span>
                        <span class="task-tag priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
                        ${dueTxt ? `<span class="task-tag due${overdueClass}">📅 ${dueTxt}</span>` : ''}
                        ${subtaskCountTag}
                    </div>
                    ${memoHtml}
                    ${urlHtml}
                    <div class="subtask-panel" id="subtask-panel-${task.id}" style="display:none">
                        <div class="subtask-list">${subtasksHtml}</div>
                        <div class="subtask-add">
                            <input type="text" class="subtask-input" id="subtask-input-${task.id}" placeholder="サブタスクを追加…">
                            <button class="btn btn-ghost btn-sm" data-action="add-subtask" data-id="${task.id}">＋</button>
                        </div>
                    </div>
                </div>
                <div class="task-item-actions">
                    <button class="btn-icon" data-action="edit-task" data-id="${task.id}" title="編集">✏️</button>
                    <button class="btn-icon danger" data-action="delete-task" data-id="${task.id}" title="削除">🗑️</button>
                </div>
            </div>`;
        }).join('');
    }

    const total = state.tasks.length;
    const done = state.tasks.filter(t => t.done).length;
    document.getElementById('task-stat-total').textContent = `全体: ${total}`;
    document.getElementById('task-stat-done').textContent = `完了: ${done}`;
    document.getElementById('task-stat-remaining').textContent = `残り: ${total - done}`;

    updateProgress();
}

let modalSubtasks = [];

function renderModalSubtasks() {
    const list = document.getElementById('modal-subtask-list');
    list.innerHTML = modalSubtasks.map((st, i) => `
        <div class="subtask-item">
            <span class="subtask-name">${escapeHtml(st.name)}</span>
            <button type="button" class="btn-icon danger subtask-delete" onclick="removeModalSubtask(${i})" style="opacity:1">✕</button>
        </div>
    `).join('');
}

window.removeModalSubtask = function (idx) {
    modalSubtasks.splice(idx, 1);
    renderModalSubtasks();
};

window.addModalSubtask = function () {
    const input = document.getElementById('modal-subtask-input');
    const name = input.value.trim();
    if (!name) return;
    modalSubtasks.push({ name, done: false });
    input.value = '';
    renderModalSubtasks();
    input.focus();
};

function initTaskForm() {
    document.getElementById('add-task-btn').addEventListener('click', () => {
        document.getElementById('task-form').reset();
        document.getElementById('task-edit-id').value = '';
        document.getElementById('modal-task-title').textContent = 'タスク追加';
        modalSubtasks = [];
        renderModalSubtasks();
        showModal('modal-task');
    });


    document.getElementById('task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('task-edit-id').value;
        const taskData = {
            name: document.getElementById('task-name').value.trim(),
            category: document.getElementById('task-category').value,
            priority: document.getElementById('task-priority').value,
            due: document.getElementById('task-due').value,
            memo: document.getElementById('task-memo').value.trim(),
            url: document.getElementById('task-url').value.trim(),
            subtasks: modalSubtasks,
        };

        if (editId) {
            await updateDoc(doc(db, 'tasks', editId), taskData);
        } else {
            await addDoc(collection(db, 'tasks'), { ...taskData, done: false, createdAt: Date.now() });
        }
        hideModal('modal-task');
    });

    document.getElementById('task-filter-category').addEventListener('change', renderTasks);
}

// ----- 場所 -----
function initPlacesListener() {
    const q = collection(db, 'places');
    onSnapshot(q, (snapshot) => {
        state.places = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPlaces();
    });
}

function renderPlaces() {
    const container = document.getElementById('place-list');

    if (state.places.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🗺️</span>
                <p>訪問先をリストアップしましょう！<br>役所、不動産屋、銀行など</p>
            </div>`;
        return;
    }

    const sorted = [...state.places].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.date && b.date) return a.date.localeCompare(b.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
    });

    container.innerHTML = sorted.map(place => {
        return `
        <div class="place-item ${place.done ? 'done' : ''}" data-id="${place.id}">
            <button class="task-checkbox ${place.done ? 'checked' : ''}" data-action="toggle-place" data-id="${place.id}">
                ${place.done ? '✓' : ''}
            </button>
            <div class="place-icon">📍</div>
            <div class="place-item-content">
                <div class="place-item-name">${escapeHtml(place.name)}</div>
                <div class="place-item-detail">
                    ${place.purpose ? `<span>📋 ${escapeHtml(place.purpose)}</span>` : ''}
                    ${place.address ? `<span>🏢 ${escapeHtml(place.address)}</span>` : ''}
                    ${place.date ? `<span>📅 ${formatDate(place.date)}</span>` : ''}
                </div>
                ${place.notes ? `<div class="task-memo-text">${escapeHtml(place.notes)}</div>` : ''}
            </div>
            <div class="place-item-actions">
                <button class="btn-icon" data-action="edit-place" data-id="${place.id}" title="編集">✏️</button>
                <button class="btn-icon danger" data-action="delete-place" data-id="${place.id}" title="削除">🗑️</button>
            </div>
        </div>`;
    }).join('');

    // 行く場所タブが表示されている場合のみマップ更新
    const placesPanel = document.getElementById('panel-places');
    if (placesPanel && placesPanel.classList.contains('active') && placesMap) {
        updatePlacesMap();
    }
}

// ----- マップ -----
let placesMap = null;
let mapMarkers = [];
let pickerMap = null;
let pickerMarker = null;

function initPlacesMap() {
    const mapEl = document.getElementById('places-map');
    if (!mapEl || placesMap) return;

    placesMap = L.map('places-map', {
        center: [35.6812, 139.7671],
        zoom: 12,
        zoomControl: true,
        attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 18,
    }).addTo(placesMap);
}

function initPickerMap() {
    const el = document.getElementById('place-map-picker');
    if (!el) return;

    // 既にマップがあれば再利用
    if (pickerMap) {
        pickerMap.invalidateSize();
        return;
    }

    pickerMap = L.map('place-map-picker', {
        center: [35.6812, 139.7671],
        zoom: 12,
        zoomControl: true,
        attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 18,
    }).addTo(pickerMap);

    // 地図タップでピン設置
    pickerMap.on('click', function (e) {
        setPickerPin(e.latlng.lat, e.latlng.lng);
    });
}

function setPickerPin(lat, lng) {
    document.getElementById('place-lat').value = lat.toFixed(6);
    document.getElementById('place-lng').value = lng.toFixed(6);

    const info = document.getElementById('place-coords-info');
    info.textContent = `✅ 位置を設定しました (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    info.classList.add('has-coords');

    if (pickerMarker) {
        pickerMarker.setLatLng([lat, lng]);
    } else if (pickerMap) {
        pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
    }
}

async function searchPlace() {
    const searchInput = document.getElementById('map-search-input');
    const searchBtn = document.getElementById('map-search-btn');
    const info = document.getElementById('place-coords-info');
    const query = searchInput.value.trim();
    if (!query) return;

    searchBtn.textContent = '検索中…';
    searchBtn.disabled = true;
    info.textContent = '🔍 検索中…';
    info.classList.remove('has-coords');

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=jp&accept-language=ja`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            setPickerPin(lat, lng);
            if (pickerMap) {
                pickerMap.setView([lat, lng], 16);
            }
            const displayName = data[0].display_name.length > 40
                ? data[0].display_name.substring(0, 40) + '…'
                : data[0].display_name;
            info.textContent = `✅ ${displayName}`;
            info.classList.add('has-coords');
        } else {
            info.textContent = '❌ 見つかりませんでした。別のキーワードで試してください';
            info.classList.remove('has-coords');
        }
    } catch (err) {
        info.textContent = '❌ 検索に失敗しました。もう一度お試しください';
        info.classList.remove('has-coords');
        console.warn('地図検索エラー:', err);
    } finally {
        searchBtn.textContent = '検索';
        searchBtn.disabled = false;
    }
}

function resetPickerMap(lat, lng) {
    const info = document.getElementById('place-coords-info');

    if (lat && lng) {
        document.getElementById('place-lat').value = lat;
        document.getElementById('place-lng').value = lng;
        info.textContent = `✅ 位置設定済み (${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)})`;
        info.classList.add('has-coords');

        if (pickerMap) {
            pickerMap.setView([parseFloat(lat), parseFloat(lng)], 15);
            if (pickerMarker) {
                pickerMarker.setLatLng([parseFloat(lat), parseFloat(lng)]);
            } else {
                pickerMarker = L.marker([parseFloat(lat), parseFloat(lng)]).addTo(pickerMap);
            }
        }
    } else {
        document.getElementById('place-lat').value = '';
        document.getElementById('place-lng').value = '';
        info.textContent = 'タップして位置を指定してください';
        info.classList.remove('has-coords');

        if (pickerMarker && pickerMap) {
            pickerMap.removeLayer(pickerMarker);
            pickerMarker = null;
        }
        if (pickerMap) {
            pickerMap.setView([35.6812, 139.7671], 12);
        }
    }
}

function updatePlacesMap() {
    if (!placesMap) return;

    // 既存マーカーをクリア
    mapMarkers.forEach(m => placesMap.removeLayer(m));
    mapMarkers = [];

    // lat/lngがあるplaceをフィルタ
    const placesWithCoords = state.places.filter(p => p.lat && p.lng);

    if (placesWithCoords.length === 0) return;

    const bounds = [];

    for (const place of placesWithCoords) {
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lng);
        if (isNaN(lat) || isNaN(lng)) continue;

        const icon = L.divIcon({
            className: 'custom-pin',
            html: `<div style="
                background: ${place.done ? '#10b981' : '#6366f1'};
                width: 28px; height: 28px;
                border-radius: 50% 50% 50% 0;
                transform: rotate(-45deg);
                border: 3px solid #fff;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                display: flex; align-items: center; justify-content: center;
            "><span style="transform:rotate(45deg);font-size:12px;">${place.done ? '✓' : '📍'}</span></div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 28],
            popupAnchor: [0, -28],
        });

        const marker = L.marker([lat, lng], { icon })
            .addTo(placesMap)
            .bindPopup(`
                <div class="popup-name">${escapeHtml(place.name)}</div>
                ${place.purpose ? `<div class="popup-purpose">📋 ${escapeHtml(place.purpose)}</div>` : ''}
                ${place.address ? `<div class="popup-purpose">🏢 ${escapeHtml(place.address)}</div>` : ''}
                ${place.date ? `<div class="popup-purpose">📅 ${formatDate(place.date)}</div>` : ''}
            `);

        mapMarkers.push(marker);
        bounds.push([lat, lng]);
    }

    if (bounds.length > 0) {
        if (bounds.length === 1) {
            placesMap.setView(bounds[0], 15);
        } else {
            placesMap.fitBounds(bounds, { padding: [30, 30] });
        }
    }
}

function initPlaceForm() {
    document.getElementById('add-place-btn').addEventListener('click', () => {
        document.getElementById('place-form').reset();
        document.getElementById('place-edit-id').value = '';
        document.getElementById('modal-place-title').textContent = '場所追加';
        document.getElementById('map-search-input').value = '';
        resetPickerMap(null, null);
        showModal('modal-place');
        // モーダル表示後にピッカーマップを初期化
        setTimeout(() => {
            initPickerMap();
            if (pickerMap) pickerMap.invalidateSize();
        }, 300);
    });

    // 検索ボタン（フォーム初期化時に1回だけ設定）
    document.getElementById('map-search-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        searchPlace();
    });

    document.getElementById('map-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            searchPlace();
        }
    });

    document.getElementById('place-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('place-edit-id').value;
        const data = {
            name: document.getElementById('place-name').value.trim(),
            purpose: document.getElementById('place-purpose').value.trim(),
            address: document.getElementById('place-address').value.trim(),
            lat: document.getElementById('place-lat').value || null,
            lng: document.getElementById('place-lng').value || null,
            date: document.getElementById('place-date').value,
            notes: document.getElementById('place-notes').value.trim(),
        };

        if (editId) {
            await updateDoc(doc(db, 'places', editId), data);
        } else {
            await addDoc(collection(db, 'places'), { ...data, done: false, createdAt: Date.now() });
        }
        hideModal('modal-place');
    });
}

// ----- 引っ越し後やることリスト -----
function initPostTasksListener() {
    const q = collection(db, 'post-tasks');
    onSnapshot(q, (snapshot) => {
        state.postTasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPostTasks();
    });
}

function renderPostTasks() {
    const container = document.getElementById('post-task-list');

    if (!state.postTasks || state.postTasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🏠</span>
                <p>引っ越し後にやることを登録しましょう！<br>住所変更など</p>
            </div>`;
        return;
    }

    const sorted = [...state.postTasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.createdAt || 0) - (b.createdAt || 0);
    });

    container.innerHTML = sorted.map(task => {
        const memoHtml = task.memo ? `<div class="task-memo-text">${escapeHtml(task.memo)}</div>` : '';
        const urlHtml = task.url ? `<div class="task-url"><a href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗 ${escapeHtml(task.url.length > 40 ? task.url.substring(0, 40) + '…' : task.url)}</a></div>` : '';

        return `
        <div class="task-item ${task.done ? 'done' : ''}" data-id="${task.id}">
            <button class="task-checkbox ${task.done ? 'checked' : ''}" data-action="toggle-post-task" data-id="${task.id}">
                ${task.done ? '✓' : ''}
            </button>
            <div class="task-item-content">
                <div class="task-item-name">${escapeHtml(task.name)}</div>
                ${memoHtml}
                ${urlHtml}
            </div>
            <div class="task-item-actions">
                <button class="btn-icon" data-action="edit-post-task" data-id="${task.id}" title="編集">✏️</button>
                <button class="btn-icon danger" data-action="delete-post-task" data-id="${task.id}" title="削除">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

function initPostTaskForm() {
    document.getElementById('add-post-task-btn').addEventListener('click', () => {
        document.getElementById('post-task-form').reset();
        document.getElementById('post-task-edit-id').value = '';
        document.getElementById('modal-post-task-title').textContent = '引っ越し後タスク追加';
        showModal('modal-post-task');
    });

    document.getElementById('post-task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('post-task-edit-id').value;
        const data = {
            name: document.getElementById('post-task-name').value.trim(),
            memo: document.getElementById('post-task-memo').value.trim(),
            url: document.getElementById('post-task-url').value.trim(),
        };

        if (editId) {
            await updateDoc(doc(db, 'post-tasks', editId), data);
        } else {
            await addDoc(collection(db, 'post-tasks'), { ...data, done: false, createdAt: Date.now() });
        }
        hideModal('modal-post-task');
    });
}

// ----- メモ -----
function initNotesListener() {
    const q = collection(db, 'notes');
    onSnapshot(q, (snapshot) => {
        state.notes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderNotes();
    });
}

function renderNotes() {
    const container = document.getElementById('notes-grid');

    if (state.notes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📝</span>
                <p>住所、連絡先、覚え書きなどを自由にメモしましょう！</p>
            </div>`;
        return;
    }

    // order順にソート（未設定はcreatedAt順）
    const sorted = [...state.notes].sort((a, b) => {
        const oa = a.order != null ? a.order : (a.createdAt || 0);
        const ob = b.order != null ? b.order : (b.createdAt || 0);
        return oa - ob;
    });

    container.innerHTML = sorted.map((note, idx) => {
        // 後方互換: note.image (単一) → note.images (配列)
        const images = note.images || (note.image ? [note.image] : []);
        const imagesHtml = images.length > 0
            ? `<div class="note-card-images">${images.map(src =>
                `<img class="note-card-thumb" src="${src}" alt="メモ画像" data-action="view-image" data-src="${src}">`
            ).join('')}</div>`
            : '';

        const urlHtml = note.url ? `<div class="task-url"><a href="${escapeHtml(note.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗 ${escapeHtml(note.url.length > 40 ? note.url.substring(0, 40) + '…' : note.url)}</a></div>` : '';

        return `
        <div class="note-card" data-id="${note.id}" style="border-top-color: ${note.color || '#6366f1'}">
            <div class="note-card-title">${escapeHtml(note.title)}</div>
            <div class="note-card-content">${escapeHtml(note.content)}</div>
            ${urlHtml}
            ${imagesHtml}
            <div class="note-card-actions">
                <button class="btn-icon" data-action="move-note-up" data-id="${note.id}" title="上へ" ${idx === 0 ? 'disabled' : ''}>⬆️</button>
                <button class="btn-icon" data-action="move-note-down" data-id="${note.id}" title="下へ" ${idx === sorted.length - 1 ? 'disabled' : ''}>⬇️</button>
                <button class="btn-icon" data-action="edit-note" data-id="${note.id}" title="編集">✏️</button>
                <button class="btn-icon danger" data-action="delete-note" data-id="${note.id}" title="削除">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

// 画像をリサイズ＆圧縮してbase64に変換
function compressImage(file, maxWidth = 800, quality = 0.6) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;

                if (w > maxWidth) {
                    h = Math.round(h * maxWidth / w);
                    w = maxWidth;
                }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 画像フルスクリーン表示
function showImageLightbox(src) {
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';
    lightbox.innerHTML = `<img src="${src}" alt="画像">`;
    lightbox.addEventListener('click', () => lightbox.remove());
    document.body.appendChild(lightbox);
}

// 複数画像管理用
let noteImages = [];

function getNoteImagesData() {
    return document.getElementById('note-images-data');
}

function renderImageThumbs() {
    const grid = document.getElementById('note-images-grid');
    grid.innerHTML = noteImages.map((src, i) => `
        <div class="image-thumb-wrap">
            <img src="${src}" alt="画像${i + 1}">
            <button type="button" class="image-remove-btn" data-img-idx="${i}">✕</button>
        </div>
    `).join('');

    // 削除ボタン
    grid.querySelectorAll('.image-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const idx = parseInt(btn.dataset.imgIdx);
            noteImages.splice(idx, 1);
            getNoteImagesData().value = JSON.stringify(noteImages);
            renderImageThumbs();
        });
    });
}

function initNoteForm() {
    const imageInput = document.getElementById('note-image-input');
    const imageBtn = document.getElementById('note-image-btn');

    document.getElementById('add-note-btn').addEventListener('click', () => {
        document.getElementById('note-form').reset();
        document.getElementById('note-edit-id').value = '';
        document.getElementById('note-color').value = '#6366f1';
        document.getElementById('modal-note-title').textContent = 'メモ追加';
        document.querySelectorAll('#note-color-picker .color-swatch').forEach(s => s.classList.remove('active'));
        document.querySelector('#note-color-picker .color-swatch[data-color="#6366f1"]').classList.add('active');
        // 画像リセット
        noteImages = [];
        getNoteImagesData().value = '[]';
        renderImageThumbs();
        showModal('modal-note');
    });

    document.querySelectorAll('#note-color-picker .color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('#note-color-picker .color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            document.getElementById('note-color').value = swatch.dataset.color;
        });
    });

    // 画像追加ボタン
    imageBtn.addEventListener('click', () => imageInput.click());

    // 画像選択後の処理
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        imageBtn.textContent = '圧縮中…';
        imageBtn.disabled = true;

        try {
            const compressed = await compressImage(file);
            noteImages.push(compressed);
            getNoteImagesData().value = JSON.stringify(noteImages);
            renderImageThumbs();
        } catch (err) {
            console.warn('画像圧縮エラー:', err);
            alert('画像の読み込みに失敗しました');
        } finally {
            imageBtn.textContent = '📷 画像を追加';
            imageBtn.disabled = false;
            imageInput.value = '';
        }
    });

    document.getElementById('note-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('note-edit-id').value;
        const data = {
            title: document.getElementById('note-title-input').value.trim(),
            content: document.getElementById('note-content').value.trim(),
            color: document.getElementById('note-color').value,
            images: noteImages,
            image: null, // 旧フィールドをクリア
            url: document.getElementById('note-url').value.trim(),
        };

        if (editId) {
            await updateDoc(doc(db, 'notes', editId), data);
        } else {
            await addDoc(collection(db, 'notes'), { ...data, createdAt: Date.now() });
        }
        hideModal('modal-note');
    });
}

// ----- 予算 -----
function initExpensesListener() {
    const q = collection(db, 'expenses');
    onSnapshot(q, (snapshot) => {
        state.expenses = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderExpenses();
    });
}

function renderExpenses() {
    const container = document.getElementById('expense-list');

    const total = state.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const paid = state.expenses.filter(e => e.status === 'paid').reduce((s, e) => s + Number(e.amount), 0);
    const unpaid = total - paid;

    document.getElementById('budget-total').textContent = formatCurrency(total);
    document.getElementById('budget-paid').textContent = formatCurrency(paid);
    document.getElementById('budget-unpaid').textContent = formatCurrency(unpaid);

    if (state.expenses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">💴</span>
                <p>引っ越しにかかる費用を記録しましょう！</p>
            </div>`;
        return;
    }

    container.innerHTML = state.expenses.map(exp => {
        return `
        <div class="expense-item" data-id="${exp.id}">
            <div class="expense-status-dot ${exp.status}"></div>
            <div class="expense-item-content">
                <div class="expense-item-name">${escapeHtml(exp.name)}</div>
                ${exp.note ? `<div class="expense-item-note">${escapeHtml(exp.note)}</div>` : ''}
            </div>
            <div class="expense-item-amount">${formatCurrency(exp.amount)}</div>
            <div class="expense-item-actions">
                <button class="btn-icon" data-action="toggle-expense" data-id="${exp.id}" title="ステータス切替">
                    ${exp.status === 'paid' ? '✅' : '⬜'}
                </button>
                <button class="btn-icon" data-action="edit-expense" data-id="${exp.id}" title="編集">✏️</button>
                <button class="btn-icon danger" data-action="delete-expense" data-id="${exp.id}" title="削除">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

function initExpenseForm() {
    document.getElementById('add-expense-btn').addEventListener('click', () => {
        document.getElementById('expense-form').reset();
        document.getElementById('expense-edit-id').value = '';
        document.getElementById('modal-expense-title').textContent = '費用追加';
        showModal('modal-expense');
    });

    document.getElementById('expense-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('expense-edit-id').value;
        const data = {
            name: document.getElementById('expense-name').value.trim(),
            amount: document.getElementById('expense-amount').value,
            status: document.getElementById('expense-status').value,
            note: document.getElementById('expense-note').value.trim(),
        };

        if (editId) {
            await updateDoc(doc(db, 'expenses', editId), data);
        } else {
            await addDoc(collection(db, 'expenses'), { ...data, createdAt: Date.now() });
        }
        hideModal('modal-expense');
    });
}

// ===== イベント委譲（動的要素のクリックハンドラ）=====
function initEventDelegation() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;

        switch (action) {
            // タスク
            case 'toggle-task': {
                const task = state.tasks.find(t => t.id === id);
                if (task) await updateDoc(doc(db, 'tasks', id), { done: !task.done });
                break;
            }
            case 'edit-task': {
                const task = state.tasks.find(t => t.id === id);
                if (!task) return;
                document.getElementById('task-edit-id').value = task.id;
                document.getElementById('task-name').value = task.name;
                document.getElementById('task-category').value = task.category;
                document.getElementById('task-priority').value = task.priority;
                document.getElementById('task-due').value = task.due || '';
                document.getElementById('task-memo').value = task.memo || '';
                document.getElementById('task-url').value = task.url || '';
                modalSubtasks = task.subtasks ? task.subtasks.map(s => ({ ...s })) : [];
                renderModalSubtasks();
                document.getElementById('modal-task-title').textContent = 'タスク編集';
                showModal('modal-task');
                break;
            }
            case 'delete-task': {
                if (!confirm('このタスクを削除しますか？')) return;
                await deleteDoc(doc(db, 'tasks', id));
                break;
            }
            case 'toggle-expand': {
                if (e.target.closest('.subtask-panel')) break;
                if (e.target.closest('.task-checkbox')) break;
                const panel = document.getElementById(`subtask-panel-${id}`);
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? '' : 'none';
                }
                break;
            }
            case 'add-subtask': {
                const input = document.getElementById(`subtask-input-${id}`);
                const name = input ? input.value.trim() : '';
                if (!name) return;
                const task = state.tasks.find(t => t.id === id);
                if (!task) return;
                const subtasks = [...(task.subtasks || []), { name, done: false }];
                await updateDoc(doc(db, 'tasks', id), { subtasks });
                break;
            }
            case 'toggle-subtask': {
                const idx = parseInt(btn.dataset.idx);
                const task = state.tasks.find(t => t.id === id);
                if (!task) return;
                const subtasks = [...(task.subtasks || [])];
                if (subtasks[idx]) {
                    subtasks[idx] = { ...subtasks[idx], done: !subtasks[idx].done };
                    await updateDoc(doc(db, 'tasks', id), { subtasks });
                }
                break;
            }
            case 'delete-subtask': {
                const idx2 = parseInt(btn.dataset.idx);
                const task = state.tasks.find(t => t.id === id);
                if (!task) return;
                const subtasks = [...(task.subtasks || [])];
                subtasks.splice(idx2, 1);
                await updateDoc(doc(db, 'tasks', id), { subtasks });
                break;
            }

            // 場所
            case 'toggle-place': {
                const place = state.places.find(p => p.id === id);
                if (place) await updateDoc(doc(db, 'places', id), { done: !place.done });
                break;
            }
            case 'edit-place': {
                const place = state.places.find(p => p.id === id);
                if (!place) return;
                document.getElementById('place-edit-id').value = place.id;
                document.getElementById('place-name').value = place.name;
                document.getElementById('place-purpose').value = place.purpose || '';
                document.getElementById('place-address').value = place.address || '';
                document.getElementById('place-date').value = place.date || '';
                document.getElementById('place-notes').value = place.notes || '';
                document.getElementById('modal-place-title').textContent = '場所編集';
                resetPickerMap(place.lat || null, place.lng || null);
                showModal('modal-place');
                setTimeout(() => {
                    initPickerMap();
                    if (pickerMap) pickerMap.invalidateSize();
                    if (place.lat && place.lng && pickerMap) {
                        pickerMap.setView([parseFloat(place.lat), parseFloat(place.lng)], 15);
                    }
                }, 300);
                break;
            }
            case 'delete-place': {
                if (!confirm('この場所を削除しますか？')) return;
                await deleteDoc(doc(db, 'places', id));
                break;
            }

            // 引っ越し後タスク
            case 'toggle-post-task': {
                const pt = state.postTasks.find(t => t.id === id);
                if (pt) await updateDoc(doc(db, 'post-tasks', id), { done: !pt.done });
                break;
            }
            case 'edit-post-task': {
                const pt = state.postTasks.find(t => t.id === id);
                if (!pt) return;
                document.getElementById('post-task-edit-id').value = pt.id;
                document.getElementById('post-task-name').value = pt.name;
                document.getElementById('post-task-memo').value = pt.memo || '';
                document.getElementById('post-task-url').value = pt.url || '';
                document.getElementById('modal-post-task-title').textContent = '引っ越し後タスク編集';
                showModal('modal-post-task');
                break;
            }
            case 'delete-post-task': {
                if (!confirm('このタスクを削除しますか？')) return;
                await deleteDoc(doc(db, 'post-tasks', id));
                break;
            }

            // メモ
            case 'edit-note': {
                const note = state.notes.find(n => n.id === id);
                if (!note) return;
                document.getElementById('note-edit-id').value = note.id;
                document.getElementById('note-title-input').value = note.title;
                document.getElementById('note-content').value = note.content;
                document.getElementById('note-color').value = note.color || '#6366f1';
                document.querySelectorAll('#note-color-picker .color-swatch').forEach(s => {
                    s.classList.toggle('active', s.dataset.color === (note.color || '#6366f1'));
                });
                // 複数画像読み込み
                noteImages = note.images || (note.image ? [note.image] : []);
                getNoteImagesData().value = JSON.stringify(noteImages);
                renderImageThumbs();
                document.getElementById('note-url').value = note.url || '';
                document.getElementById('modal-note-title').textContent = 'メモ編集';
                showModal('modal-note');
                break;
            }
            case 'delete-note': {
                if (!confirm('このメモを削除しますか？')) return;
                await deleteDoc(doc(db, 'notes', id));
                break;
            }
            case 'move-note-up':
            case 'move-note-down': {
                const sorted = [...state.notes].sort((a, b) => {
                    const oa = a.order != null ? a.order : (a.createdAt || 0);
                    const ob = b.order != null ? b.order : (b.createdAt || 0);
                    return oa - ob;
                });
                const curIdx = sorted.findIndex(n => n.id === id);
                const swapIdx = action === 'move-note-up' ? curIdx - 1 : curIdx + 1;
                if (curIdx < 0 || swapIdx < 0 || swapIdx >= sorted.length) break;

                const curNote = sorted[curIdx];
                const swapNote = sorted[swapIdx];
                const curOrder = curNote.order != null ? curNote.order : curIdx;
                const swapOrder = swapNote.order != null ? swapNote.order : swapIdx;

                await updateDoc(doc(db, 'notes', curNote.id), { order: swapOrder });
                await updateDoc(doc(db, 'notes', swapNote.id), { order: curOrder });
                break;
            }
            case 'view-image': {
                const src = btn.dataset.src;
                if (src) showImageLightbox(src);
                break;
            }

            // 予算
            case 'toggle-expense': {
                const exp = state.expenses.find(e => e.id === id);
                if (exp) await updateDoc(doc(db, 'expenses', id), { status: exp.status === 'paid' ? 'unpaid' : 'paid' });
                break;
            }
            case 'edit-expense': {
                const exp = state.expenses.find(e => e.id === id);
                if (!exp) return;
                document.getElementById('expense-edit-id').value = exp.id;
                document.getElementById('expense-name').value = exp.name;
                document.getElementById('expense-amount').value = exp.amount;
                document.getElementById('expense-status').value = exp.status;
                document.getElementById('expense-note').value = exp.note || '';
                document.getElementById('modal-expense-title').textContent = '費用編集';
                showModal('modal-expense');
                break;
            }
            case 'delete-expense': {
                if (!confirm('この費用を削除しますか？')) return;
                await deleteDoc(doc(db, 'expenses', id));
                break;
            }
        }
    });
}

// ===== パスワード認証 =====
const PASSWORD_HASH = 'bf4ddaf2e95f25ba2480c9ec5f9950e9f141b2e8d106f712630a49cfbb2204f4';

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function initAuth() {
    // sessionStorageに認証済みフラグがあればスキップ
    if (sessionStorage.getItem('hikkoshi_auth') === 'ok') {
        unlockApp();
        return;
    }

    const form = document.getElementById('auth-form');
    const passwordInput = document.getElementById('auth-password');
    const errorEl = document.getElementById('auth-error');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = passwordInput.value;
        const hash = await sha256(input);

        if (hash === PASSWORD_HASH) {
            sessionStorage.setItem('hikkoshi_auth', 'ok');
            unlockApp();
        } else {
            errorEl.textContent = 'パスワードが違います';
            passwordInput.value = '';
            passwordInput.focus();
            // シェイクアニメーション
            const card = document.querySelector('.auth-card');
            card.classList.remove('shake');
            void card.offsetWidth; // reflow
            card.classList.add('shake');
        }
    });

    passwordInput.focus();
}

async function unlockApp() {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('app-wrapper').style.display = '';
    await initApp();
}

// ===== アプリ初期化（認証後に実行）=====
async function initApp() {
    initTabs();
    initModals();
    initMovingDate();
    initTaskForm();
    initPlaceForm();
    initPostTaskForm();
    initNoteForm();
    initExpenseForm();
    initEventDelegation();

    // Firestoreリアルタイムリスナー開始
    await loadSettings();
    initTasksListener();
    initPlacesListener();
    initPostTasksListener();
    initNotesListener();
    initExpensesListener();

    updateCountdown();
    setInterval(updateCountdown, 1000);
}

document.addEventListener('DOMContentLoaded', initAuth);
