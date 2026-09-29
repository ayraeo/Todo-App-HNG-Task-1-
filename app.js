// ================================================================
//  FlowTask — app.js
//  Features: CRUD, Notes, Priority, Tags, Due Dates,
//            Pomodoro Focus Timer, Local Storage
// ================================================================

'use strict';

/* ── State ── */
let tasks = [];
let currentFilter = 'all';
let searchQuery = '';
let sortBy = 'created';
let editingTaskId = null;
let deleteTargetId = null;
let pomodoroState = {
  isRunning: false,
  timeLeft: 25 * 60,
  totalTime: 25 * 60,
  phase: 'focus',   // 'focus' | 'break'
  focusTaskId: null,
  pomodorosCompleted: 0,
  interval: null,
};
let doneTodayCount = 0;

/* ── Storage Keys ── */
const STORAGE_TASKS = 'flowtask_tasks_v2';
const STORAGE_STATS = 'flowtask_stats_v1';

/* ── Utils ── */
const uid = () => `t_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const today = () => new Date().toISOString().slice(0,10);
const qs  = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function saveTasks() {
  localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
}
function loadTasks() {
  try { tasks = JSON.parse(localStorage.getItem(STORAGE_TASKS) || '[]'); } catch { tasks = []; }
}
function saveStats() {
  localStorage.setItem(STORAGE_STATS, JSON.stringify({ done: doneTodayCount, pomodoros: pomodoroState.pomodorosCompleted }));
}
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_STATS) || '{}');
    doneTodayCount = s.done || 0;
    pomodoroState.pomodorosCompleted = s.pomodoros || 0;
  } catch {}
}

/* ── DOM refs ── */
const taskList       = qs('#task-list');
const emptyState     = qs('#empty-state');
const taskModal      = qs('#task-modal');
const detailModal    = qs('#detail-modal');
const confirmModal   = qs('#confirm-modal');
const taskForm       = qs('#task-form');
const toast          = qs('#toast');
const sidebar        = qs('#sidebar');
const sidebarOverlay = qs('#sidebar-overlay');
const progressFill   = qs('#progress-bar-fill');
const progressText   = qs('#progress-text');
const progressPct    = qs('#progress-pct');
const progressWrap   = qs('#progress-bar-wrap');

/* ================================================================
   TASK CRUD
   ================================================================ */

function createTask(data) {
  const task = {
    id:        uid(),
    title:     data.title.trim(),
    desc:      data.desc?.trim() || '',
    priority:  data.priority || 'medium',
    dueDate:   data.dueDate || '',
    tags:      parseTags(data.tags),
    notes:     data.notes?.trim() || '',
    completed: false,
    createdAt: Date.now(),
    completedAt: null,
  };
  tasks.unshift(task);
  saveTasks();
  renderAll();
  showToast('Task created! 🎉', 'success');
  return task;
}

function updateTask(id, data) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  tasks[idx] = {
    ...tasks[idx],
    title:    data.title.trim(),
    desc:     data.desc?.trim() || '',
    priority: data.priority || 'medium',
    dueDate:  data.dueDate || '',
    tags:     parseTags(data.tags),
    notes:    data.notes?.trim() || '',
  };
  saveTasks();
  renderAll();
  showToast('Task updated ✓', 'success');
}

function toggleComplete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? Date.now() : null;
  if (task.completed) {
    doneTodayCount++;
    saveStats();
    showToast(`"${truncate(task.title, 30)}" completed! 🎊`, 'success');
  }
  saveTasks();
  renderAll();
}

function deleteTask(id) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  const title = tasks[idx].title;
  tasks.splice(idx, 1);
  saveTasks();
  renderAll();
  showToast(`"${truncate(title, 30)}" deleted`, 'error');
  if (pomodoroState.focusTaskId === id) {
    pomodoroState.focusTaskId = null;
    qs('#pomodoro-focus-task').textContent = 'No task selected';
  }
}

function parseTags(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
}
function truncate(str, n) { return str.length > n ? str.slice(0,n) + '…' : str; }

/* ================================================================
   FILTER & SORT
   ================================================================ */

function getFilteredTasks() {
  let result = [...tasks];

  // Filter
  if (currentFilter === 'today') {
    result = result.filter(t => t.dueDate === today() || isCreatedToday(t));
  } else if (currentFilter === 'pending') {
    result = result.filter(t => !t.completed);
  } else if (currentFilter === 'completed') {
    result = result.filter(t => t.completed);
  } else if (currentFilter === 'high') {
    result = result.filter(t => t.priority === 'high');
  }

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }

  // Sort
  result.sort((a, b) => {
    if (sortBy === 'priority') {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
    } else if (sortBy === 'dueDate') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    } else if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    return b.createdAt - a.createdAt; // default: newest first
  });

  return result;
}

function isCreatedToday(task) {
  return new Date(task.createdAt).toISOString().slice(0,10) === today();
}

/* ================================================================
   RENDER
   ================================================================ */

function renderAll() {
  updateBadges();
  updateProgress();
  updateStats();
  renderTaskList();
}

function renderTaskList() {
  const filtered = getFilteredTasks();
  taskList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.add('show');
    return;
  }
  emptyState.classList.remove('show');

  filtered.forEach((task, i) => {
    const card = buildTaskCard(task);
    card.style.animationDelay = `${i * 0.04}s`;
    taskList.appendChild(card);
  });
}

function buildTaskCard(task) {
  const priorityColors = { low: 'var(--priority-low)', medium: 'var(--priority-medium)', high: 'var(--priority-high)' };

  const div = document.createElement('div');
  div.className = `task-card${task.completed ? ' is-completed' : ''}`;
  div.setAttribute('role', 'listitem');
  div.setAttribute('data-id', task.id);
  div.style.setProperty('--priority-color', priorityColors[task.priority]);

  const dueDateHTML = task.dueDate ? buildDueDateHTML(task.dueDate) : '';
  const tagsHTML = task.tags.map(t => `<span class="tag-chip">#${t}</span>`).join('');
  const notesHTML = task.notes ? `<span class="notes-indicator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Note</span>` : '';
  const isFocused = pomodoroState.focusTaskId === task.id;

  div.innerHTML = `
    <button class="task-check" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}" title="${task.completed ? 'Mark incomplete' : 'Mark complete'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
    <div class="task-card-body">
      <div class="task-card-header">
        <span class="task-card-title">${escHtml(task.title)}</span>
      </div>
      ${task.desc ? `<p class="task-card-desc">${escHtml(task.desc)}</p>` : ''}
      <div class="task-card-footer">
        <span class="priority-badge priority-badge--${task.priority}">${task.priority}</span>
        ${dueDateHTML}
        ${tagsHTML}
        ${notesHTML}
      </div>
    </div>
    <div class="task-card-actions">
      <button class="card-action-btn card-action-btn--focus ${isFocused ? 'card-action-btn--active' : ''}" data-action="focus" title="${isFocused ? 'Currently focusing' : 'Start focus'}" aria-label="Focus on this task">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>
      <button class="card-action-btn card-action-btn--edit" data-action="edit" title="Edit task" aria-label="Edit task">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="card-action-btn card-action-btn--delete" data-action="delete" title="Delete task" aria-label="Delete task">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>
    </div>
  `;

  // Events
  qs('.task-check', div).addEventListener('click', e => { e.stopPropagation(); toggleComplete(task.id); });
  qs('[data-action="edit"]', div).addEventListener('click', e => { e.stopPropagation(); openEditModal(task.id); });
  qs('[data-action="delete"]', div).addEventListener('click', e => { e.stopPropagation(); openConfirmDelete(task.id); });
  qs('[data-action="focus"]', div).addEventListener('click', e => { e.stopPropagation(); setFocusTask(task.id); });
  div.addEventListener('click', () => openDetailModal(task.id));

  return div;
}

function buildDueDateHTML(dateStr) {
  const due = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.ceil((due - now) / (1000*60*60*24));
  let cls = 'due-date';
  let label = formatDate(dateStr);
  if (diffDays < 0) { cls += ' overdue'; label = `Overdue: ${label}`; }
  else if (diffDays <= 2) cls += ' due-soon';
  return `<span class="${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${label}</span>`;
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Progress ── */
function updateProgress() {
  const total = tasks.length;
  const done  = tasks.filter(t => t.completed).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
  progressFill.style.width = pct + '%';
  progressText.textContent = `${done} of ${total} task${total !== 1 ? 's' : ''} completed`;
  progressPct.textContent = pct + '%';
  progressWrap.setAttribute('aria-valuenow', pct);
}

/* ── Badges ── */
function updateBadges() {
  const all = tasks.length;
  const todayTasks = tasks.filter(t => t.dueDate === today() || isCreatedToday(t)).length;
  const pending   = tasks.filter(t => !t.completed).length;
  const completed = tasks.filter(t => t.completed).length;
  const high      = tasks.filter(t => t.priority === 'high').length;
  qs('#badge-all').textContent      = all;
  qs('#badge-today').textContent    = todayTasks;
  qs('#badge-pending').textContent  = pending;
  qs('#badge-completed').textContent= completed;
  qs('#badge-high').textContent     = high;
}

/* ── Stats ── */
function updateStats() {
  qs('#stat-done').textContent   = doneTodayCount;
  qs('#stat-streak').textContent = pomodoroState.pomodorosCompleted;
}

/* ── Page title ── */
const FILTER_LABELS = {
  all: ['All Tasks', 'Manage and conquer your day'],
  today: ["Today's Tasks", "Focused on what matters now"],
  pending: ['Pending Tasks', 'Tasks waiting to be completed'],
  completed: ['Completed Tasks', 'Your wins and achievements'],
  high: ['High Priority', 'Critical tasks that need attention first'],
};
function updatePageTitle() {
  const [title, sub] = FILTER_LABELS[currentFilter] || FILTER_LABELS.all;
  qs('#page-title').textContent = title;
  qs('#page-subtitle').textContent = sub;
}

/* ================================================================
   MODALS
   ================================================================ */

/* ── Create/Edit Modal ── */
function openCreateModal() {
  editingTaskId = null;
  taskForm.reset();
  qs('#edit-task-id').value = '';
  qs('#modal-title').textContent = 'New Task';
  qs('#modal-submit').textContent = 'Create Task';
  qs('#title-count').textContent = '0 / 150';
  // Set today's date as default
  qs('#task-due').value = '';
  taskModal.showModal();
  setTimeout(() => qs('#task-title').focus(), 50);
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  qs('#edit-task-id').value     = id;
  qs('#task-title').value       = task.title;
  qs('#task-desc').value        = task.desc;
  qs('#task-priority').value    = task.priority;
  qs('#task-due').value         = task.dueDate;
  qs('#task-tags').value        = task.tags.join(', ');
  qs('#task-notes').value       = task.notes;
  qs('#modal-title').textContent  = 'Edit Task';
  qs('#modal-submit').textContent = 'Save Changes';
  qs('#title-count').textContent  = `${task.title.length} / 150`;
  taskModal.showModal();
  setTimeout(() => qs('#task-title').focus(), 50);
  detailModal.close();
}

function openDetailModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const priorityColors = { low: 'priority-badge--low', medium: 'priority-badge--medium', high: 'priority-badge--high' };
  qs('#detail-priority-badge').className = `detail-priority-badge priority-badge ${priorityColors[task.priority]}`;
  qs('#detail-priority-badge').textContent = task.priority;
  qs('#detail-date').textContent = task.dueDate ? `Due ${formatDate(task.dueDate)}` : (task.createdAt ? `Created ${new Date(task.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : '');
  qs('#detail-title').textContent = task.title;
  qs('#detail-desc').textContent  = task.desc || '';
  qs('#detail-desc').style.display = task.desc ? '' : 'none';

  const tagsEl = qs('#detail-tags');
  tagsEl.innerHTML = task.tags.map(t => `<span class="tag-chip">#${t}</span>`).join('');

  const notesSection = qs('#detail-notes-section');
  if (task.notes) {
    notesSection.style.display = '';
    qs('#detail-notes').textContent = task.notes;
  } else {
    notesSection.style.display = 'none';
  }

  const completeBtn = qs('#detail-complete-btn');
  if (task.completed) {
    completeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> Reopen Task`;
    completeBtn.className = 'btn btn--ghost';
  } else {
    completeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Mark Complete`;
    completeBtn.className = 'btn btn--success';
  }

  completeBtn.onclick = () => { toggleComplete(id); detailModal.close(); };
  qs('#detail-edit-btn').onclick   = () => openEditModal(id);
  qs('#detail-delete-btn').onclick = () => { detailModal.close(); openConfirmDelete(id); };
  qs('#detail-focus-btn').onclick  = () => { setFocusTask(id); detailModal.close(); };

  detailModal.showModal();
}

function openConfirmDelete(id) {
  deleteTargetId = id;
  confirmModal.showModal();
}

/* ── Form Submit ── */
taskForm.addEventListener('submit', e => {
  e.preventDefault();
  const title = qs('#task-title').value.trim();
  if (!title) { qs('#task-title').focus(); return; }
  const data = {
    title,
    desc:     qs('#task-desc').value,
    priority: qs('#task-priority').value,
    dueDate:  qs('#task-due').value,
    tags:     qs('#task-tags').value,
    notes:    qs('#task-notes').value,
  };
  if (editingTaskId) {
    updateTask(editingTaskId, data);
  } else {
    createTask(data);
  }
  taskModal.close();
});

/* ── Close buttons ── */
qs('#modal-close').addEventListener('click',   () => taskModal.close());
qs('#modal-cancel').addEventListener('click',  () => taskModal.close());
qs('#detail-close').addEventListener('click',  () => detailModal.close());
qs('#confirm-cancel').addEventListener('click',() => { confirmModal.close(); deleteTargetId = null; });
qs('#confirm-delete').addEventListener('click',() => {
  if (deleteTargetId) deleteTask(deleteTargetId);
  deleteTargetId = null;
  confirmModal.close();
});

/* ── Character counter ── */
qs('#task-title').addEventListener('input', function() {
  qs('#title-count').textContent = `${this.value.length} / 150`;
});

/* ── Add task buttons ── */
qs('#add-task-btn').addEventListener('click',    openCreateModal);
qs('#mobile-add-btn').addEventListener('click',  openCreateModal);
qs('#empty-add-btn').addEventListener('click',   openCreateModal);

/* ================================================================
   FILTER + SEARCH + SORT
   ================================================================ */

qsa('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    updatePageTitle();
    renderTaskList();
    // Close sidebar on mobile
    if (window.innerWidth <= 900) closeSidebar();
  });
});

qs('#search-input').addEventListener('input', function() {
  searchQuery = this.value;
  renderTaskList();
});

qs('#sort-select').addEventListener('change', function() {
  sortBy = this.value;
  renderTaskList();
});

/* ================================================================
   MOBILE SIDEBAR
   ================================================================ */

const mobileMenuBtn = qs('#mobile-menu-btn');

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('show');
  mobileMenuBtn.setAttribute('aria-expanded', 'true');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
  mobileMenuBtn.setAttribute('aria-expanded', 'false');
}
mobileMenuBtn.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarOverlay.addEventListener('click', closeSidebar);

/* ================================================================
   POMODORO FOCUS TIMER
   ================================================================ */

const POMO_FOCUS_DURATION = 25 * 60;  // seconds
const POMO_BREAK_DURATION = 5 * 60;

const pomoTimeEl  = qs('#pomodoro-time');
const pomoLabelEl = qs('#pomodoro-label');
const pomoToggle  = qs('#pomo-toggle');
const pomoReset   = qs('#pomo-reset');
const pomoSkip    = qs('#pomo-skip');
const ringProgress= qs('#ring-progress');
const ringCircumference = 314;

function formatPomoTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2,'0');
  const s = (secs % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function updatePomoUI() {
  pomoTimeEl.textContent = formatPomoTime(pomodoroState.timeLeft);
  const progress = 1 - (pomodoroState.timeLeft / pomodoroState.totalTime);
  ringProgress.style.strokeDashoffset = (ringCircumference * (1 - progress)).toString();
  pomoLabelEl.textContent = pomodoroState.phase === 'focus' ? 'Focus Session' : '☕ Break Time';

  const playIcon  = qs('#pomo-icon-play');
  const pauseIcon = qs('#pomo-icon-pause');
  if (pomodoroState.isRunning) {
    playIcon.style.display  = 'none';
    pauseIcon.style.display = '';
  } else {
    playIcon.style.display  = '';
    pauseIcon.style.display = 'none';
  }
}

function setFocusTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  if (pomodoroState.focusTaskId === taskId) {
    // Deselect
    pomodoroState.focusTaskId = null;
    qs('#pomodoro-focus-task').textContent = 'No task selected';
    showToast('Focus task deselected', 'info');
  } else {
    pomodoroState.focusTaskId = taskId;
    qs('#pomodoro-focus-task').textContent = `🎯 ${task.title}`;
    showToast(`Focusing on: "${truncate(task.title, 30)}"`, 'info');
  }
  renderTaskList(); // update card highlights
}

function startPomo() {
  if (pomodoroState.interval) return;
  pomodoroState.isRunning = true;
  pomodoroState.interval = setInterval(() => {
    pomodoroState.timeLeft--;
    updatePomoUI();
    if (pomodoroState.timeLeft <= 0) {
      pomodoroComplete();
    }
  }, 1000);
  updatePomoUI();
}

function pausePomo() {
  clearInterval(pomodoroState.interval);
  pomodoroState.interval = null;
  pomodoroState.isRunning = false;
  updatePomoUI();
}

function resetPomo() {
  pausePomo();
  pomodoroState.phase    = 'focus';
  pomodoroState.timeLeft = POMO_FOCUS_DURATION;
  pomodoroState.totalTime= POMO_FOCUS_DURATION;
  updatePomoUI();
}

function skipPomo() {
  pausePomo();
  if (pomodoroState.phase === 'focus') {
    pomodoroState.phase    = 'break';
    pomodoroState.timeLeft = POMO_BREAK_DURATION;
    pomodoroState.totalTime= POMO_BREAK_DURATION;
  } else {
    pomodoroState.phase    = 'focus';
    pomodoroState.timeLeft = POMO_FOCUS_DURATION;
    pomodoroState.totalTime= POMO_FOCUS_DURATION;
  }
  updatePomoUI();
}

function pomodoroComplete() {
  pausePomo();
  if (pomodoroState.phase === 'focus') {
    pomodoroState.pomodorosCompleted++;
    saveStats();
    updateStats();
    showToast('🍅 Focus session complete! Take a break.', 'success');
    pomodoroState.phase    = 'break';
    pomodoroState.timeLeft = POMO_BREAK_DURATION;
    pomodoroState.totalTime= POMO_BREAK_DURATION;
    // Play a notification sound (simple beep)
    playBeep(880, 0.15, 0.3);
  } else {
    showToast('⚡ Break over! Ready to focus?', 'info');
    pomodoroState.phase    = 'focus';
    pomodoroState.timeLeft = POMO_FOCUS_DURATION;
    pomodoroState.totalTime= POMO_FOCUS_DURATION;
    playBeep(660, 0.1, 0.2);
  }
  updatePomoUI();
}

function playBeep(freq, volume, duration) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch(e) { /* Audio not available */ }
}

pomoToggle.addEventListener('click', () => {
  pomodoroState.isRunning ? pausePomo() : startPomo();
});
pomoReset.addEventListener('click', resetPomo);
pomoSkip.addEventListener('click', skipPomo);

/* ================================================================
   TOAST
   ================================================================ */

let toastTimeout;
function showToast(message, type = 'info') {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.className = `toast toast--${type} show`;
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

/* ================================================================
   KEYBOARD SHORTCUTS
   ================================================================ */

document.addEventListener('keydown', e => {
  // N = New task (when not in input)
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
    e.preventDefault();
    openCreateModal();
  }
  // Escape = close any open modal
  if (e.key === 'Escape') {
    if (confirmModal.open) { confirmModal.close(); deleteTargetId = null; }
    else if (detailModal.open) { detailModal.close(); }
    else if (taskModal.open) { taskModal.close(); }
  }
  // P = toggle pomodoro timer (when not in input)
  if (e.key === 'p' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
    e.preventDefault();
    pomodoroState.isRunning ? pausePomo() : startPomo();
  }
});

function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
}

/* ================================================================
   INIT
   ================================================================ */

function init() {
  loadTasks();
  loadStats();
  updatePomoUI();
  updatePageTitle();
  renderAll();

  // Seed demo tasks if no tasks exist
  if (tasks.length === 0) {
    seedDemoTasks();
  }
}

function seedDemoTasks() {
  const demos = [
    {
      title: '🎨 Design new landing page',
      desc: 'Create wireframes and high-fidelity mockups for the new marketing site redesign.',
      priority: 'high',
      dueDate: today(),
      tags: ['design', 'urgent'],
      notes: '# Resources\n- Figma file: https://figma.com/...\n- Brand guide V3\n- Competitor analysis doc\n\nKey focus: hero section animation, mobile responsiveness',
    },
    {
      title: '📊 Prepare weekly report',
      desc: 'Compile metrics and KPIs for the stakeholder meeting on Friday.',
      priority: 'medium',
      dueDate: '',
      tags: ['reporting', 'work'],
      notes: 'Include: DAU, MRR, churn rate, NPS score\nCompare to last 4 weeks',
    },
    {
      title: '📚 Read "Deep Work" chapters 3–5',
      desc: 'Continue reading the productivity book and take notes.',
      priority: 'low',
      dueDate: '',
      tags: ['personal', 'reading'],
      notes: '',
    },
    {
      title: '🔧 Fix authentication bug',
      desc: 'Users are being logged out unexpectedly after 10 minutes. Investigate token refresh logic.',
      priority: 'high',
      dueDate: today(),
      tags: ['dev', 'bug'],
      notes: 'Error seen in Sentry: TokenExpiredError\nAffects ~12% of users on mobile\nCheck: /api/auth/refresh endpoint',
    },
  ];

  demos.reverse().forEach((d, i) => {
    const task = {
      id:          uid(),
      title:       d.title,
      desc:        d.desc,
      priority:    d.priority,
      dueDate:     d.dueDate,
      tags:        d.tags,
      notes:       d.notes,
      completed:   false,
      createdAt:   Date.now() - i * 60000,
      completedAt: null,
    };
    tasks.unshift(task);
  });
  saveTasks();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
