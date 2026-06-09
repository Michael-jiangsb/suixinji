/* ===== 随心记 App - 前端逻辑 ===== */

// ====== 全局状态 ======
let currentTopicId = null;
let currentView = 'notes';
let topics = [];
let notes = [];
let currentNoteId = null;
let selectedTopicColor = '#4A90D9';
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', async () => {
  await loadTopics();
  await loadNotes(null);
  await loadStats();
  initVoice();
  initImageDrop();
  // 键盘快捷键
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllModals();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const activeInput = document.querySelector('.input-panel:not(.hidden) .note-textarea');
      if (activeInput && activeInput.value.trim()) {
        const mode = document.querySelector('.tab-btn.active').dataset.mode;
        if (mode === 'text') submitTextNote();
        else if (mode === 'voice') submitVoiceNote();
      }
    }
  });
});

// ====== 统计数据 ======
async function loadStats() {
  try {
    const data = await api('/api/stats');
    document.getElementById('statTopics').textContent = data.total_topics;
    document.getElementById('statNotes').textContent = data.total_notes;
    document.getElementById('statToday').textContent = data.today_notes;
  } catch(e) {}
}

// ====== 主题管理 ======
async function loadTopics() {
  try {
    topics = await api('/api/topics');
    renderTopicList();
    updateTopicSelects();
  } catch(e) {
    console.error('加载主题失败', e);
  }
}

function renderTopicList() {
  const list = document.getElementById('topicList');
  list.innerHTML = '';

  // 全部
  const allItem = createTopicItem(null, '全部想法', '#888', topics.reduce((s,t) => s + (t.note_count||0), 0));
  allItem.classList.add('topic-item-all');
  if (currentTopicId === null) allItem.classList.add('active');
  list.appendChild(allItem);

  // 各主题
  topics.forEach(t => {
    const item = createTopicItem(t.id, t.name, t.color, t.note_count || 0);
    if (currentTopicId === t.id) item.classList.add('active');
    list.appendChild(item);
  });
}

function createTopicItem(id, name, color, count) {
  const div = document.createElement('div');
  div.className = 'topic-item';
  div.innerHTML = `
    <span class="topic-dot" style="background:${color}"></span>
    <span class="topic-name">${escapeHtml(name)}</span>
    <span class="topic-count">${count}</span>
    ${id ? `<div class="topic-actions">
      <button class="btn-icon-xs" onclick="event.stopPropagation();deleteTopic(${id})" title="删除">✕</button>
    </div>` : ''}
  `;
  div.onclick = () => selectTopic(id, name, color);
  return div;
}

function updateTopicSelects() {
  const selects = ['textTopicSelect', 'voiceTopicSelect', 'ocrTopicSelect', 'modalTopicSelect'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">不归属任何主题</option>';
    topics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    if (val) sel.value = val;
    if (currentTopicId) sel.value = currentTopicId;
  });
}

async function selectTopic(id, name, color) {
  currentTopicId = id;
  renderTopicList();
  const titleEl = document.getElementById('currentTopicName');
  const subtitleEl = document.getElementById('currentTopicSubtitle');
  const btnMindmap = document.getElementById('btnShowMindmap');

  if (id === null) {
    titleEl.textContent = '全部想法';
    subtitleEl.textContent = '所有主题的想法汇总';
    btnMindmap.style.display = 'none';
  } else {
    titleEl.textContent = name;
    subtitleEl.textContent = `主题色 · ${color}`;
    btnMindmap.style.display = 'inline-flex';
  }

  updateTopicSelects();
  if (currentView === 'notes') {
    await loadNotes(id);
  } else if (currentView === 'mindmap') {
    await loadMindmap(id);
  }
}

async function deleteTopic(id) {
  if (!confirm('确定删除该主题？主题下的所有想法也会被删除。')) return;
  await api(`/api/topics/${id}`, 'DELETE');
  if (currentTopicId === id) {
    currentTopicId = null;
    await loadNotes(null);
  }
  await loadTopics();
  await loadStats();
  toast('主题已删除');
}

// ====== 新建主题弹窗 ======
function openNewTopicModal() {
  document.getElementById('newTopicName').value = '';
  selectedTopicColor = '#4A90D9';
  document.querySelectorAll('.color-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === selectedTopicColor);
  });
  openModal('modalNewTopic');
  setTimeout(() => document.getElementById('newTopicName').focus(), 100);
}

function selectColor(el) {
  document.querySelectorAll('.color-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedTopicColor = el.dataset.color;
}

async function saveTopic() {
  const name = document.getElementById('newTopicName').value.trim();
  if (!name) { toast('请输入主题名称', 'error'); return; }
  try {
    await api('/api/topics', 'POST', { name, color: selectedTopicColor });
    closeModal('modalNewTopic');
    await loadTopics();
    await loadStats();
    toast('主题创建成功', 'success');
  } catch(e) {
    toast('创建失败：' + e.message, 'error');
  }
}

// ====== 笔记管理 ======
async function loadNotes(topicId) {
  try {
    const url = topicId ? `/api/notes?topic_id=${topicId}` : '/api/notes';
    notes = await api(url);
    renderNotes();
  } catch(e) {
    console.error('加载笔记失败', e);
  }
}

function renderNotes() {
  const container = document.getElementById('notesContainer');
  const empty = document.getElementById('emptyState');

  if (!notes || notes.length === 0) {
    container.innerHTML = '';
    container.appendChild(empty);
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  const grid = document.createElement('div');
  grid.className = 'notes-grid';

  notes.forEach(note => {
    const topic = topics.find(t => t.id === note.topic_id);
    const sourceLabel = { text: '文字', voice: '语音', ocr: 'OCR' }[note.source] || '文字';
    const sourceClass = `source-${note.source || 'text'}`;

    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <button class="note-card-delete" onclick="event.stopPropagation();deleteNote(${note.id})">删除</button>
      <div class="note-card-source">
        <span class="source-badge ${sourceClass}">${sourceLabel}</span>
        <span>${formatTime(note.created_at)}</span>
      </div>
      <div class="note-card-content">${escapeHtml(note.content)}</div>
      ${note.summary ? `<div class="note-card-summary">${escapeHtml(note.summary)}</div>` : ''}
      <div class="note-card-footer">
        <span class="note-card-time">${formatDate(note.created_at)}</span>
        ${topic ? `<span class="note-card-topic" style="background:${topic.color}">${escapeHtml(topic.name)}</span>` : ''}
      </div>
    `;
    card.onclick = () => openNoteDetail(note);
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

async function deleteNote(id) {
  if (!confirm('确定删除这条想法？')) return;
  await api(`/api/notes/${id}`, 'DELETE');
  await loadNotes(currentTopicId);
  await loadStats();
  await loadTopics();
  toast('已删除');
}

// ====== 输入模式切换 ======
function switchInputMode(mode) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.input-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`panel${mode.charAt(0).toUpperCase() + mode.slice(1)}`).classList.remove('hidden');
}

// ====== 文字输入 ======
async function submitTextNote() {
  const content = document.getElementById('textInput').value.trim();
  const topicId = document.getElementById('textTopicSelect').value;
  if (!content) { toast('请输入想法内容', 'error'); return; }
  await saveNote(content, 'text', topicId);
  document.getElementById('textInput').value = '';
}

// ====== 语音输入（Whisper 本地识别） ======

async function initVoice() {
  // 检查 MediaRecorder 支持
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('voiceHint').textContent = '当前浏览器不支持录音，请使用 Chrome/Edge';
    document.getElementById('btnVoice').disabled = true;
    return;
  }
  // 初始化完成，等待用户点击开始录音
}

async function toggleVoice() {
  if (isRecording) stopRecording();
  else await startRecording();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 优先使用 webm 格式（Chrome），fallback 到其他格式
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/ogg;codecs=opus';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // 停止所有轨道
      stream.getTracks().forEach(t => t.stop());
      // 处理录音结果
      await processAudioBlob();
    };

    mediaRecorder.start();
    isRecording = true;
    document.getElementById('voiceIconWrap').classList.add('recording');
    document.getElementById('voiceHint').textContent = '正在录音，请说话…';
    document.getElementById('btnVoice').textContent = '停止录音';
    document.getElementById('btnVoice').classList.add('recording');
  } catch (e) {
    toast('无法访问麦克风: ' + e.message, 'error');
  }
}

function stopRecording() {
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  document.getElementById('voiceIconWrap').classList.remove('recording');
  document.getElementById('voiceHint').textContent = '正在识别语音…';
  document.getElementById('btnVoice').textContent = '识别中…';
  document.getElementById('btnVoice').classList.remove('recording');
  document.getElementById('btnVoice').disabled = true;
}

async function processAudioBlob() {
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
  // 确定文件扩展名
  const ext = mediaRecorder.mimeType.includes('webm') ? 'webm'
    : mediaRecorder.mimeType.includes('mp4') ? 'm4a'
    : 'ogg';

  const formData = new FormData();
  formData.append('audio', blob, `recording.${ext}`);

  document.getElementById('voiceTextResult').value = '正在识别语音，请稍候…';

  try {
    const res = await fetch('/api/speech-to-text', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) {
      toast(data.error, 'error');
      document.getElementById('voiceTextResult').value = '';
      document.getElementById('voiceHint').textContent = '识别失败，请重试';
    } else {
      document.getElementById('voiceTextResult').value = data.text;
      document.getElementById('voiceHint').textContent = `识别完成 (${data.method})`;
    }
  } catch (e) {
    toast('语音识别请求失败: ' + e.message, 'error');
    document.getElementById('voiceTextResult').value = '';
    document.getElementById('voiceHint').textContent = '识别失败，请重试';
  } finally {
    document.getElementById('btnVoice').textContent = '开始录音';
    document.getElementById('btnVoice').disabled = false;
  }
}

async function submitVoiceNote() {
  const content = document.getElementById('voiceTextResult').value.trim();
  const topicId = document.getElementById('voiceTopicSelect').value;
  if (!content) { toast('语音内容为空，请先录音', 'error'); return; }
  if (isRecording) stopRecording();
  await saveNote(content, 'voice', topicId);
  document.getElementById('voiceTextResult').value = '';
}

// ====== 图片 OCR ======
function initImageDrop() {
  const zone = document.getElementById('imageDropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processImageFile(file);
  });
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (file) processImageFile(file);
}

async function processImageFile(file) {
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'];
  if (!allowed.includes(file.type)) { toast('不支持的图片格式', 'error'); return; }

  // 显示预览
  const reader = new FileReader();
  reader.onload = e => document.getElementById('ocrPreviewImg').src = e.target.result;
  reader.readAsDataURL(file);

  document.getElementById('ocrTextEdit').value = '识别中，请稍候…';
  document.getElementById('imageDropZone').style.display = 'none';
  document.getElementById('ocrResult').classList.remove('hidden');

  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await fetch('/api/ocr', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }

    document.getElementById('ocrPreviewImg').src = data.image_url;
    document.getElementById('ocrTextEdit').value = data.paragraphs.join('\n');
    const badge = document.getElementById('ocrMethodBadge');
    if (data.method === 'unavailable') {
      badge.textContent = '需安装MarkItDown';
      badge.style.background = '#FFF3E0';
      badge.style.color = '#E65100';
      toast(data.hint || 'OCR功能需安装MarkItDown', 'error');
    } else if (data.method === 'markitdown') {
      badge.textContent = 'MarkItDown识别';
    } else {
      badge.textContent = data.method || '识别完成';
    }
  } catch(e) {
    toast('OCR请求失败: ' + e.message, 'error');
    document.getElementById('ocrTextEdit').value = '';
  }
}

function resetOcr() {
  document.getElementById('imageDropZone').style.display = '';
  document.getElementById('ocrResult').classList.add('hidden');
  document.getElementById('imageFileInput').value = '';
  document.getElementById('ocrTextEdit').value = '';
}

async function submitOcrNote() {
  const content = document.getElementById('ocrTextEdit').value.trim();
  const topicId = document.getElementById('ocrTopicSelect').value;
  if (!content || content.includes('识别中')) { toast('请先上传图片并等待识别', 'error'); return; }
  await saveNote(content, 'ocr', topicId);
  resetOcr();
}

// ====== 通用保存笔记 ======
async function saveNote(content, source, topicId) {
  try {
    const note = await api('/api/notes', 'POST', {
      content,
      source,
      topic_id: topicId || null
    });

    // 乐观更新：立即将新笔记插入到 notes 数组头部，实现即时显示
    notes.unshift(note);
    renderNotes();

    // 然后异步刷新确保数据一致性（静默更新，不影响已渲染的内容）
    loadNotes(currentTopicId).catch(() => {});
    loadStats().catch(() => {});
    loadTopics().catch(() => {});

    toast(`想法已保存${note.summary ? '：' + note.summary : ''}`, 'success');
  } catch(e) {
    toast('保存失败: ' + e.message, 'error');
    // 回滚：如果保存失败，重新加载恢复状态
    loadNotes(currentTopicId).catch(() => {});
  }
}

// ====== 新建想法弹窗 ======
function openNewNoteModal() {
  document.getElementById('modalNoteContent').value = '';
  updateTopicSelects();
  openModal('modalNewNote');
  setTimeout(() => document.getElementById('modalNoteContent').focus(), 100);
}

async function saveModalNote() {
  const content = document.getElementById('modalNoteContent').value.trim();
  const topicId = document.getElementById('modalTopicSelect').value;
  if (!content) { toast('请输入想法内容', 'error'); return; }
  await saveNote(content, 'text', topicId);
  closeModal('modalNewNote');
}

// ====== 笔记详情 ======
function openNoteDetail(note) {
  currentNoteId = note.id;
  const topic = topics.find(t => t.id === note.topic_id);
  document.getElementById('noteDetailMeta').innerHTML =
    `来源：${note.source === 'voice' ? '语音' : note.source === 'ocr' ? '图片OCR' : '文字'} · 
     创建于 ${formatDate(note.created_at)} ${formatTime(note.created_at)}` +
    (topic ? ` · 主题：${escapeHtml(topic.name)}` : '');
  document.getElementById('noteDetailContent').value = note.content;

  const summaryBox = document.getElementById('noteDetailSummaryBox');
  const summaryText = document.getElementById('noteDetailSummary');
  if (note.summary) {
    summaryText.textContent = note.summary;
    summaryBox.style.display = 'flex';
  } else {
    summaryBox.style.display = 'none';
  }
  openModal('modalNoteDetail');
}

async function saveNoteDetail() {
  const content = document.getElementById('noteDetailContent').value.trim();
  if (!content) { toast('内容不能为空', 'error'); return; }
  try {
    const note = await api(`/api/notes/${currentNoteId}`, 'PUT', { content });
    const summaryText = document.getElementById('noteDetailSummary');
    const summaryBox = document.getElementById('noteDetailSummaryBox');
    if (note.summary) {
      summaryText.textContent = note.summary;
      summaryBox.style.display = 'flex';
    }
    await loadNotes(currentTopicId);
    closeModal('modalNoteDetail');
    toast('已保存', 'success');
  } catch(e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

async function deleteCurrentNote() {
  if (!confirm('确定删除这条想法？')) return;
  await api(`/api/notes/${currentNoteId}`, 'DELETE');
  await loadNotes(currentTopicId);
  await loadStats();
  await loadTopics();
  closeModal('modalNoteDetail');
  toast('已删除');
}

// ====== 视图切换 ======
function showView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view${view.charAt(0).toUpperCase() + view.slice(1)}`).classList.add('active');
  if (view === 'mindmap') loadMindmap(currentTopicId);
}

// ====== 思维导图（可编辑交互模式） ======
let mmSelectedNode = null;
let mmEditMode = null; // 'create_child' | 'create_sibling' | 'edit'
let mmEditParentId = null;
let mmTopicData = null; // 当前加载的主题数据
let apMode = 'write'; // 'write' | 'import'
let apSelectedNoteId = null; // 从笔记导入时选中的笔记ID

async function loadMindmap(topicId) {
  const container = document.getElementById('mindmapContainer');
  const emptyEl = document.getElementById('mindmapEmpty');
  const titleEl = document.getElementById('mindmapTitle');
  const subtitleEl = document.getElementById('mindmapSubtitle');
  const toolbar = document.getElementById('mmToolbar');
  const treeEl = document.getElementById('mmTree');
  const svgEl = document.getElementById('mindmapSvg');

  if (!topicId) {
    container.style.display = 'none';
    emptyEl.style.display = 'block';
    toolbar.style.display = 'none';
    emptyEl.innerHTML = '<p>请先在左侧选择一个主题，再查看思维导图</p>';
    return;
  }

  try {
    const data = await api(`/api/mindmap/${topicId}`);
    mmTopicData = data;
    mmSelectedNode = null;
    titleEl.textContent = data.topic.name + ' — 思维导图';
    subtitleEl.textContent = `共 ${data.note_count} 条想法 · 点击节点编辑`;

    if (data.note_count === 0) {
      container.style.display = 'none';
      emptyEl.style.display = 'block';
      toolbar.style.display = 'none';
      svgEl.style.display = 'none';
      emptyEl.innerHTML = '<p>该主题还没有想法，先去添加一些吧</p>';
      return;
    }

    container.style.display = 'block';
    emptyEl.style.display = 'none';
    toolbar.style.display = 'flex';

    // 优先使用交互式树形图
    svgEl.style.display = 'none';
    treeEl.style.display = 'block';
    renderMmTree(data, treeEl);

  } catch(e) {
    toast('思维导图加载失败: ' + e.message, 'error');
  }
}

/** 渲染交互式树形思维导图 */
function renderMmTree(data, treeEl) {
  const nodes = data.nodes || [];
  treeEl.innerHTML = '';

  // 根节点
  const rootWrap = document.createElement('div');
  rootWrap.className = 'mm-node-wrap';

  const rootNode = createMmNode(data.topic.name, null, true, 'root');
  rootWrap.appendChild(rootNode);

  // 子节点容器
  if (nodes.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'mm-children';
    nodes.forEach(n => {
      childrenContainer.appendChild(buildNodeTree(n));
    });
    // 添加子节点按钮
    const addBtn = createAddBtn(null);
    childrenContainer.appendChild(addBtn);
    rootWrap.appendChild(childrenContainer);
  } else {
    // 即使没有节点，也显示添加按钮
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'mm-children';
    childrenContainer.appendChild(createAddBtn(null));
    rootWrap.appendChild(childrenContainer);
  }

  treeEl.appendChild(rootWrap);
}

/** 递归构建节点树 */
function buildNodeTree(node) {
  const wrap = document.createElement('div');
  wrap.className = 'mm-child-row';
  wrap.setAttribute('data-node-id', node.id);

  const nodeEl = createMmNode(node.label, node.id, false, 'child');
  wrap.appendChild(nodeEl);

  if (node.children && node.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'mm-children';
    node.children.forEach(child => {
      childrenContainer.appendChild(buildNodeTree(child));
    });
    childrenContainer.appendChild(createAddBtn(node.id));
    wrap.appendChild(childrenContainer);
  }

  return wrap;
}

/** 创建思维导图节点 DOM */
function createMmNode(label, nodeId, isRoot, type) {
  const el = document.createElement('div');
  el.className = 'mm-node' + (isRoot ? ' root-node' : '');
  el.setAttribute('data-node-id', nodeId || 'root');
  el.title = label; // 鼠标悬停显示完整文字

  // 折叠按钮
  const toggle = document.createElement('button');
  toggle.className = 'mm-node-toggle empty';
  toggle.innerHTML = '▾';
  toggle.onclick = (e) => {
    e.stopPropagation();
    toggleMmNode(el);
  };
  el.appendChild(toggle);

  // 文字标签
  const labelSpan = document.createElement('span');
  labelSpan.className = 'mm-node-label';
  labelSpan.textContent = label;
  el.appendChild(labelSpan);

  // 点击选中
  el.onclick = (e) => {
    e.stopPropagation();
    selectMmNode(el, nodeId, label, isRoot);
  };

  // 双击编辑
  el.ondblclick = (e) => {
    e.stopPropagation();
    if (!isRoot) {
      selectMmNode(el, nodeId, label, isRoot);
      mmEditNode();
    }
  };

  // 右键菜单
  el.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectMmNode(el, nodeId, label, isRoot);
    if (!isRoot) {
      showMmContextMenu(e);
    }
  };

  // 拖拽排序
  el.draggable = !isRoot;
  el.ondragstart = (e) => {
    if (isRoot) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', nodeId);
    e.dataTransfer.effectAllowed = 'move';
    el.style.opacity = '0.5';
  };
  el.ondragend = (e) => {
    el.style.opacity = '1';
    document.querySelectorAll('.mm-node.drag-over').forEach(n => n.classList.remove('drag-over'));
  };
  el.ondragover = (e) => {
    if (isRoot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  };
  el.ondragleave = (e) => {
    el.classList.remove('drag-over');
  };
  el.ondrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');
    const fromId = e.dataTransfer.getData('text/plain');
    const toId = nodeId;
    if (fromId === toId) return;

    try {
      await api('/api/mindmap/nodes/reorder', 'POST', {
        orders: [{ id: parseInt(fromId), parent_id: nodeId, order_idx: 0 }]
      });
      loadMindmap(currentTopicId);
      toast('节点已移动');
    } catch(err) {
      toast('移动失败: ' + err.message, 'error');
    }
  };

  return el;
}

/** 选中节点 */
function selectMmNode(el, nodeId, label, isRoot) {
  document.querySelectorAll('.mm-node.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');
  mmSelectedNode = isRoot ? null : { id: nodeId, label, el };
  updateToolbarState();
}

/** 更新工具栏按钮状态 */
function updateToolbarState() {
  const toolbar = document.getElementById('mmToolbar');
  toolbar.style.display = 'flex';
  // 可以基于是否有选中节点来调整按钮可用状态
}

/** 折叠/展开节点 */
function toggleMmNode(nodeEl) {
  nodeEl.classList.toggle('collapsed');
  const toggle = nodeEl.querySelector('.mm-node-toggle');
  toggle.textContent = nodeEl.classList.contains('collapsed') ? '▸' : '▾';
  updateToggleButtons();
}

/** 更新折叠按钮可见性 */
function updateToggleButtons() {
  document.querySelectorAll('.mm-node').forEach(nodeEl => {
    const toggle = nodeEl.querySelector('.mm-node-toggle');
    const parent = nodeEl.parentElement;
    // 检查父元素是否有子节点容器
    let hasChildren = false;
    if (parent) {
      const siblings = Array.from(parent.children);
      hasChildren = siblings.some(s => s.classList && s.classList.contains('mm-children'));
    }
    toggle.classList.toggle('empty', !hasChildren);
  });
}

/** 添加子节点 */
function mmAddChild() {
  if (!mmSelectedNode) {
    toast('请先选中一个节点', 'error');
    return;
  }
  mmEditMode = 'create_child';
  mmEditParentId = mmSelectedNode.id;
  document.getElementById('mmModalTitle').textContent = '添加子节点';
  document.getElementById('mmNodeLabel').value = '';
  openModal('modalMmNode');
  document.getElementById('mmNodeLabel').focus();
}

/** 添加同级节点 */
function mmAddSibling() {
  if (!mmSelectedNode) {
    toast('请先选中一个节点', 'error');
    return;
  }
  mmEditMode = 'create_sibling';
  mmEditParentId = mmSelectedNode.id;
  document.getElementById('mmModalTitle').textContent = '添加同级节点';
  document.getElementById('mmNodeLabel').value = '';
  openModal('modalMmNode');
  document.getElementById('mmNodeLabel').focus();
}

/** 编辑选中节点 */
function mmEditNode() {
  if (!mmSelectedNode) {
    toast('请先选中一个节点', 'error');
    return;
  }
  mmEditMode = 'edit';
  mmEditParentId = mmSelectedNode.id;
  document.getElementById('mmModalTitle').textContent = '编辑节点';
  document.getElementById('mmNodeLabel').value = mmSelectedNode.label;
  openModal('modalMmNode');
  document.getElementById('mmNodeLabel').focus();
}

/** 保存节点（创建或编辑） */
async function mmSaveNode() {
  const label = document.getElementById('mmNodeLabel').value.trim();
  if (!label) { toast('节点文字不能为空', 'error'); return; }

  try {
    if (mmEditMode === 'create_child') {
      // 创建子节点
      await api(`/api/mindmap/${currentTopicId}/nodes`, 'POST', {
        label,
        parent_id: mmEditParentId
      });
      toast('子节点已添加', 'success');
    } else if (mmEditMode === 'create_sibling') {
      // 获取父节点ID（同级节点使用相同的parent_id）
      let parentId = null;
      if (mmEditParentId !== null) {
        try {
          const data = await api(`/api/mindmap/${currentTopicId}`);
          const allNodes = flattenNodes(data.nodes);
          const targetNode = allNodes.find(n => n.id === mmEditParentId);
          if (targetNode) parentId = targetNode.parent_id;
        } catch(e) {}
      }
      await api(`/api/mindmap/${currentTopicId}/nodes`, 'POST', {
        label,
        parent_id: parentId
      });
      toast('同级节点已添加', 'success');
    } else if (mmEditMode === 'edit') {
      // 编辑节点
      await api(`/api/mindmap/nodes/${mmEditParentId}`, 'PUT', { label });
      toast('节点已更新', 'success');
    }
    closeModal('modalMmNode');
    mmSelectedNode = null;
    loadMindmap(currentTopicId);
  } catch(err) {
    toast('操作失败: ' + err.message, 'error');
  }
}

/** 删除选中节点 */
async function mmDeleteNode() {
  if (!mmSelectedNode) {
    toast('请先选中一个节点', 'error');
    return;
  }
  if (!confirm(`确定删除节点「${mmSelectedNode.label}」及其所有子节点？`)) return;

  try {
    await api(`/api/mindmap/nodes/${mmSelectedNode.id}`, 'DELETE');
    mmSelectedNode = null;
    loadMindmap(currentTopicId);
    toast('节点已删除', 'success');
  } catch(err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

/** 右键菜单 */
function showMmContextMenu(e) {
  // 移除旧菜单
  document.querySelectorAll('.mm-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'mm-context-menu';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:3000;
    background:white;border:0.5px solid var(--color-border);border-radius:8px;
    box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;min-width:140px;`;

  const items = [
    { label: '添加子节点', action: 'mmAddChild()' },
    { label: '添加同级节点', action: 'mmAddSibling()' },
    { label: '编辑', action: 'mmEditNode()' },
    { label: '删除', action: 'mmDeleteNode()', danger: true },
  ];

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'mm-context-item';
    btn.textContent = item.label;
    btn.style.cssText = `display:block;width:100%;text-align:left;padding:6px 12px;
      border:none;background:none;cursor:pointer;font-size:13px;border-radius:4px;
      ${item.danger ? 'color:#E24B4A;' : ''}`;
    btn.onmouseenter = () => btn.style.background = item.danger ? '#FEE2E2' : '#f3f4f6';
    btn.onmouseleave = () => btn.style.background = 'none';
    btn.onclick = () => {
      menu.remove();
      if (item.action === 'mmAddChild()') mmAddChild();
      else if (item.action === 'mmAddSibling()') mmAddSibling();
      else if (item.action === 'mmEditNode()') mmEditNode();
      else if (item.action === 'mmDeleteNode()') mmDeleteNode();
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  // 点击其他地方关闭
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 50);
}

/** 扁平化节点列表 */
function flattenNodes(nodes, parentId) {
  let result = [];
  nodes.forEach(n => {
    result.push({ id: n.id, parent_id: n.parent_id });
    if (n.children && n.children.length > 0) {
      result = result.concat(flattenNodes(n.children, n.id));
    }
  });
  return result;
}

/** 创建添加按钮 */
function createAddBtn(parentId) {
  const btn = document.createElement('button');
  btn.className = 'mm-add-btn';
  btn.innerHTML = '+';
  btn.title = '添加节点';
  btn.onclick = (e) => {
    e.stopPropagation();
    if (parentId === null) {
      // 根节点下添加
      mmEditMode = 'create_sibling';
      mmEditParentId = null;
      mmSelectedNode = { id: null, label: '', el: null };
      document.getElementById('mmModalTitle').textContent = '添加节点';
      document.getElementById('mmNodeLabel').value = '';
      openModal('modalMmNode');
      document.getElementById('mmNodeLabel').focus();
    } else {
      mmEditMode = 'create_child';
      mmEditParentId = parentId;
      mmSelectedNode = { id: parentId, label: '', el: null };
      document.getElementById('mmModalTitle').textContent = '添加子节点';
      document.getElementById('mmNodeLabel').value = '';
      openModal('modalMmNode');
      document.getElementById('mmNodeLabel').focus();
    }
  };
  return btn;
}

/** 点击思维导图空白区域取消选中 */
document.addEventListener('click', function(e) {
  if (e.target.closest('#viewMindmap') && !e.target.closest('.mm-node') && !e.target.closest('.mm-context-menu') && !e.target.closest('.mm-add-btn')) {
    document.querySelectorAll('.mm-node.selected').forEach(n => n.classList.remove('selected'));
    mmSelectedNode = null;
  }
});

// ====== 旧版 Markdown/SVG 思维导图（保留备用） ======
function parseMarkdownToTree(markdown) {
  const lines = markdown.split('\n').filter(l => l.trim());
  const root = { content: '', children: [] };
  let currentH2 = null;

  lines.forEach(line => {
    if (line.startsWith('# ')) {
      root.content = line.slice(2).trim();
    } else if (line.startsWith('## ')) {
      currentH2 = { content: line.slice(3).trim(), children: [] };
      root.children.push(currentH2);
    } else if (line.startsWith('- ')) {
      const node = { content: line.slice(2).trim(), children: [] };
      if (currentH2) currentH2.children.push(node);
      else root.children.push(node);
    }
  });
  return root;
}

function renderSvgTree(data, container, svgEl) {
  const lines = data.markdown.split('\n');
  const topic = lines.find(l => l.startsWith('# '))?.slice(2) || '思维导图';
  const h2nodes = [];
  let cur = null;
  lines.forEach(l => {
    if (l.startsWith('## ')) { cur = { label: l.slice(3), children: [] }; h2nodes.push(cur); }
    else if (l.startsWith('- ') && cur) cur.children.push(l.slice(2));
  });

  const W = container.clientWidth || 800;
  const nodeH = 36;
  const hGap = 60, vGap = 16;
  const rootX = 40, rootY = 20;

  let totalH = 0;
  const blocks = h2nodes.map(n => {
    const h = nodeH + (n.children.length ? n.children.length * (nodeH + vGap) + vGap : 0);
    totalH += h + 20;
    return { ...n, blockH: h };
  });
  const svgH = Math.max(totalH + 60, 300);

  svgEl.setAttribute('viewBox', `0 0 ${W} ${svgH}`);
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', svgH);
  svgEl.style.display = 'block';

  let svg = `<defs><style>
    .mm-root{font:500 14px/1.4 -apple-system,sans-serif;fill:#0C447C;}
    .mm-h2{font:500 13px/1.4 -apple-system,sans-serif;fill:#185FA5;}
    .mm-leaf{font:400 12px/1.4 -apple-system,sans-serif;fill:#444;}
    .mm-edge{fill:none;stroke:#B5D4F4;stroke-width:1.5;}
  </style></defs>`;

  const rootBoxW = Math.min(Math.max(topic.length * 14 + 24, 120), 240);
  const rootBoxH = 40;
  const rootCX = rootX + rootBoxW / 2;
  const rootCY = rootY + rootBoxH / 2;
  svg += `<rect x="${rootX}" y="${rootY}" width="${rootBoxW}" height="${rootBoxH}" rx="8" fill="#E6F1FB" stroke="#378ADD" stroke-width="1"/>`;
  svg += `<text x="${rootCX}" y="${rootCY + 1}" text-anchor="middle" dominant-baseline="central" class="mm-root">${escapeHtml(truncate(topic, 14))}</text>`;

  const colX = rootX + rootBoxW + hGap;
  let curY = rootY;

  blocks.forEach(block => {
    const boxW = Math.min(Math.max(block.label.length * 13 + 24, 120), 200);
    svg += `<path class="mm-edge" d="M${rootX + rootBoxW} ${rootCY} C${colX - hGap / 2} ${rootCY},${colX - hGap / 2} ${curY + nodeH / 2},${colX} ${curY + nodeH / 2}"/>`;
    svg += `<rect x="${colX}" y="${curY}" width="${boxW}" height="${nodeH}" rx="6" fill="#EAF3DE" stroke="#3B6D11" stroke-width="0.8"/>`;
    svg += `<text x="${colX + boxW / 2}" y="${curY + nodeH / 2 + 1}" text-anchor="middle" dominant-baseline="central" class="mm-h2">${escapeHtml(truncate(block.label, 13))}</text>`;

    const leafX = colX + boxW + hGap * 0.8;
    block.children.forEach((child, i) => {
      const ly = curY + (i + 1) * (nodeH + vGap) - vGap / 2;
      const leafW = Math.min(Math.max(child.length * 12 + 20, 100), 200);
      svg += `<path class="mm-edge" d="M${colX + boxW} ${curY + nodeH / 2} C${leafX - 20} ${curY + nodeH / 2},${leafX - 20} ${ly + nodeH / 2},${leafX} ${ly + nodeH / 2}"/>`;
      svg += `<rect x="${leafX}" y="${ly}" width="${leafW}" height="${nodeH}" rx="5" fill="#FAEEDA" stroke="#EF9F27" stroke-width="0.8"/>`;
      svg += `<text x="${leafX + leafW / 2}" y="${ly + nodeH / 2 + 1}" text-anchor="middle" dominant-baseline="central" class="mm-leaf">${escapeHtml(truncate(child, 14))}</text>`;
    });
    curY += block.blockH + 20;
  });

  svgEl.innerHTML = svg;
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

// ====== 思维导图自动排版 ======

/** 切换自动排版面板显示/隐藏 */
function toggleAutoParse() {
  if (!currentTopicId) {
    toast('请先选择一个主题', 'error');
    return;
  }
  const panel = document.getElementById('autoParsePanel');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (!isHidden) return;

  // 展开时初始化
  switchApMode('write');
  document.getElementById('apTextInput').value = '';
  document.getElementById('apOverwrite').checked = false;
  apSelectedNoteId = null;

  // 滚动到面板
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('apTextInput').focus(), 200);
}

/** 切换自动排版模式（自由输入 / 从笔记导入） */
function switchApMode(mode) {
  apMode = mode;
  document.querySelectorAll('.ap-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.apMode === mode));
  document.getElementById('apPanelWrite').classList.toggle('hidden', mode !== 'write');
  document.getElementById('apPanelImport').classList.toggle('hidden', mode !== 'import');

  // 自由输入模式显示"清空"按钮，导入模式隐藏
  document.getElementById('btnApClear').style.display = (mode === 'write') ? '' : 'none';

  if (mode === 'import') {
    loadImportableNotes();
  } else {
    setTimeout(() => document.getElementById('apTextInput').focus(), 100);
  }
}

/** 加载可导入的笔记列表 */
async function loadImportableNotes() {
  const listEl = document.getElementById('apImportList');
  if (!currentTopicId) {
    listEl.innerHTML = '<div class="ap-import-empty">请先选择一个主题</div>';
    return;
  }

  try {
    const notes = await api(`/api/notes?topic_id=${currentTopicId}`);
    if (!notes || notes.length === 0) {
      listEl.innerHTML = '<div class="ap-import-empty">该主题下暂无笔记，请先在笔记列表中添加一些想法</div>';
      return;
    }

    apSelectedNoteId = null;
    let html = '';
    notes.forEach(note => {
      const sourceLabel = { text: '文字', voice: '语音', ocr: 'OCR' }[note.source] || '文字';
      html += `
        <div class="ap-import-item" data-note-id="${note.id}" onclick="selectImportNote(${note.id}, this)">
          <input type="radio" class="ap-import-radio" name="apImportNote" value="${note.id}">
          <div>
            <div class="ap-import-content">${escapeHtml(note.content)}</div>
            <div class="ap-import-meta">${sourceLabel} · ${formatDate(note.created_at)} · ${(note.summary || '')}</div>
          </div>
        </div>`;
    });
    listEl.innerHTML = html;
  } catch(e) {
    listEl.innerHTML = '<div class="ap-import-empty">加载笔记失败</div>';
  }
}

/** 选中导入笔记 */
function selectImportNote(noteId, el) {
  apSelectedNoteId = noteId;
  document.querySelectorAll('.ap-import-item').forEach(item => item.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input[type="radio"]').checked = true;
}

/** 清空输入 */
function clearApText() {
  document.getElementById('apTextInput').value = '';
  document.getElementById('apTextInput').focus();
}

/** 执行自动排版 */
async function doAutoParse() {
  if (!currentTopicId) {
    toast('请先选择一个主题', 'error');
    return;
  }

  let text = '';

  if (apMode === 'write') {
    text = document.getElementById('apTextInput').value.trim();
  } else if (apMode === 'import') {
    if (!apSelectedNoteId) {
      toast('请选择一条笔记', 'error');
      return;
    }
    // 获取笔记内容
    try {
      const notes = await api(`/api/notes?topic_id=${currentTopicId}`);
      const note = notes.find(n => n.id === apSelectedNoteId);
      if (!note) {
        toast('笔记不存在', 'error');
        return;
      }
      text = note.content.trim();
    } catch(e) {
      toast('获取笔记内容失败: ' + e.message, 'error');
      return;
    }
  }

  if (!text) {
    toast('请输入或选择要排版的内容', 'error');
    return;
  }

  const overwrite = document.getElementById('apOverwrite').checked;

  // 如果有已有节点且未勾选覆盖，弹出确认
  if (!overwrite && mmTopicData && mmTopicData.nodes && mmTopicData.nodes.length > 0) {
    if (!confirm('当前主题已有思维导图节点，是否覆盖？\n\n选择"确定"将覆盖已有节点，选择"取消"将追加到现有结构中。')) {
      // 用户选择取消 = 不覆盖 = 追加模式
      // 覆盖确认后仍走原有 overwrite=false 逻辑（后端追加）
    }
  }

  // 显示加载状态
  const btn = document.getElementById('btnAutoParse');
  const btnText = document.getElementById('btnAutoParseText');
  const btnSpinner = document.getElementById('btnAutoParseSpinner');
  btn.disabled = true;
  btnText.textContent = '解析中…';
  btnSpinner.classList.remove('hidden');

  try {
    const result = await api(`/api/mindmap/${currentTopicId}/auto-parse`, 'POST', {
      text: text,
      overwrite: overwrite
    });

    btn.disabled = false;
    btnText.textContent = '生成思维导图';
    btnSpinner.classList.add('hidden');

    // 关闭面板
    document.getElementById('autoParsePanel').classList.add('hidden');

    // 刷新思维导图显示
    await loadMindmap(currentTopicId);
    toast(`成功生成 ${result.nodes_created} 个节点，可点击节点进行编辑`, 'success');
  } catch(e) {
    btn.disabled = false;
    btnText.textContent = '生成思维导图';
    btnSpinner.classList.add('hidden');
    toast('自动排版失败: ' + e.message, 'error');
  }
}


// ====== 工具函数 ======
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

function toast(msg, type = '') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastIn 0.3s reverse';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str.replace(' ', 'T'));
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(str) {
  if (!str) return '';
  const d = new Date(str.replace(' ', 'T'));
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Enter键确认主题创建
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('newTopicName').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTopic();
  });
});
