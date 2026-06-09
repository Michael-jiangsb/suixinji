/**
 * 随心记 - 鸿蒙 H5 版前端逻辑
 * 语音识别：Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 * 图片 OCR：Tesseract.js (WebAssembly 离线引擎)
 * 用户认证：本地 localStorage 存储登录状态
 */

// ====== 用户认证 ======
const AUTH_USERNAME = 'admin';
const AUTH_PASSWORD = '159357';
const AUTH_KEY = 'suixinji_auth';

function isLoggedIn() {
  try {
    const auth = localStorage.getItem(AUTH_KEY);
    if (!auth) return false;
    const data = JSON.parse(auth);
    return data.loggedIn === true && data.timestamp && (Date.now() - data.timestamp < 7 * 24 * 3600 * 1000);
  } catch (e) { return false; }
}

function setLoggedIn() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ loggedIn: true, timestamp: Date.now() }));
}

function clearLogin() {
  localStorage.removeItem(AUTH_KEY);
}

function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  const btnText = document.getElementById('loginBtnText');
  const btnSpinner = document.getElementById('loginBtnSpinner');
  const btn = document.getElementById('loginBtn');

  if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
    errorEl.textContent = '账号或密码错误，请重试';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  btn.disabled = true;
  btnText.classList.add('hidden');
  btnSpinner.classList.remove('hidden');

  setTimeout(() => {
    setLoggedIn();
    document.getElementById('loginOverlay').classList.add('hidden');
    btn.disabled = false;
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');
    showToast('登录成功');
  }, 600);
}

function handleLogout() {
  if (confirm('确定要退出登录吗？')) {
    clearLogin();
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    showToast('已退出登录');
  }
}

// 回车键登录
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !document.getElementById('loginOverlay').classList.contains('hidden')) {
    e.preventDefault();
    handleLogin();
  }
});

// ====== 全局状态 ======
let currentTopicId = null;
let currentView = 'notes';
let topics = [];
let notes = [];
let currentNoteId = null;
let selectedTopicColor = '#4A90D9';
let isRecording = false;

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', async () => {
  // 检查登录状态
  if (isLoggedIn()) {
    document.getElementById('loginOverlay').classList.add('hidden');
  }
  await loadTopics();
  await loadNotes(null);
  await loadStats();
  initVoice();
  initImageDrop();
  initImageOnlyDrop();
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
    const data = await apiGetStats();
    document.getElementById('statTopics').textContent = data.total_topics;
    document.getElementById('statNotes').textContent = data.total_notes;
    document.getElementById('statToday').textContent = data.today_notes;
  } catch(e) {}
}

// ====== 主题管理 ======
async function loadTopics() {
  try {
    topics = await apiGetTopics();
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
  const totalCount = topics.reduce((s, t) => s + (t.note_count || 0), 0);
  const allItem = createTopicItem(null, '全部想法', '#888', totalCount);
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
  const selects = ['textTopicSelect', 'voiceTopicSelect', 'ocrTopicSelect', 'imageOnlyTopicSelect', 'modalTopicSelect'];
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
    subtitleEl.textContent = '主题色 · ' + color;
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
  await apiDeleteTopic(id);
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
    await apiCreateTopic({ name, color: selectedTopicColor });
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
    notes = await apiGetNotes(topicId);
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
    const topic = topics.find(t => t.id === note.topicId);
    const sourceLabel = { text: '文字', voice: '语音', ocr: 'OCR' }[note.source] || '文字';
    const sourceClass = `source-${note.source || 'text'}`;

    const card = document.createElement('div');
    card.className = 'note-card';
    const hasImage = note.imageData && note.source === 'ocr';
    card.innerHTML = `
      <button class="note-card-delete" onclick="event.stopPropagation();deleteNote(${note.id})">删除</button>
      <div class="note-card-source">
        <span class="source-badge ${sourceClass}">${sourceLabel}</span>
        <span>${formatTime(note.createdAt)}</span>
      </div>
      ${hasImage ? `<div class="note-card-image"><img src="${note.imageData}" alt="图片"></div>` : ''}
      <div class="note-card-content">${escapeHtml(note.content)}</div>
      ${note.summary ? `<div class="note-card-summary">${escapeHtml(note.summary)}</div>` : ''}
      <div class="note-card-footer">
        <span class="note-card-time">${formatDate(note.createdAt)}</span>
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
  await apiDeleteNote(id);
  await loadNotes(currentTopicId);
  await loadStats();
  await loadTopics();
  toast('已删除');
}

// ====== 输入模式切换 ======
function switchInputMode(mode) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.input-panel').forEach(p => p.classList.add('hidden'));
  const cap = mode.charAt(0).toUpperCase() + mode.slice(1);
  // imageOnly 对应 panelImageOnly
  const panelId = mode === 'imageOnly' ? 'panelImageOnly' : `panel${cap}`;
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.remove('hidden');
}

// ====== 文字输入 ======
async function submitTextNote() {
  const content = document.getElementById('textInput').value.trim();
  const topicId = document.getElementById('textTopicSelect').value;
  if (!content) { toast('请输入想法内容', 'error'); return; }
  await saveNote(content, 'text', topicId);
  document.getElementById('textInput').value = '';
}

// ====== 语音输入（Web Speech API） ======

let speechRecognition = null;
let speechFinalText = '';

async function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hintEl = document.getElementById('voiceHint');
  const btnEl = document.getElementById('btnVoice');

  if (!SpeechRecognition) {
    hintEl.textContent = '当前浏览器不支持语音识别（需要 Chrome 或 Edge）';
    btnEl.textContent = '暂不可用';
    btnEl.disabled = true;
    return;
  }

  // 检查是否 HTTPS 或 localhost
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) {
    hintEl.textContent = '语音识别需要 HTTPS 或本地访问，请使用 https:// 开头的地址';
    btnEl.textContent = '暂不可用';
    btnEl.disabled = true;
    return;
  }

  try {
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'zh-CN';
    speechRecognition.interimResults = true;
    speechRecognition.continuous = true;
    speechRecognition.maxAlternatives = 1;

    speechRecognition.onstart = () => {
      isRecording = true;
      speechFinalText = '';
      document.getElementById('voiceIconWrap').classList.add('recording');
      document.getElementById('voiceHint').textContent = '正在聆听，请说话…';
      document.getElementById('btnVoice').textContent = '停止识别';
      document.getElementById('btnVoice').classList.add('recording');
    };

    speechRecognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          speechFinalText += transcript;
        } else {
          interim += transcript;
        }
      }
      document.getElementById('voiceTextResult').value = speechFinalText + interim;
      document.getElementById('voiceHint').textContent = speechFinalText ? '识别中…（结果可编辑）' : '正在聆听…';
    };

    speechRecognition.onerror = (event) => {
      console.error('SpeechRecognition error:', event.error, event.message);
      let msg = '';
      switch (event.error) {
        case 'no-speech': msg = '未检测到语音，请重试'; break;
        case 'audio-capture': msg = '无法访问麦克风，请检查设备权限'; break;
        case 'not-allowed': msg = '麦克风权限被拒绝，请在浏览器设置中允许'; break;
        case 'network': msg = '语音识别需要联网（Chrome 云端识别），请检查网络'; break;
        case 'aborted': msg = '识别已中止'; break;
        case 'language-not-supported': msg = '不支持中文语音识别'; break;
        case 'service-not-allowed': msg = '语音识别服务不可用，请检查浏览器设置'; break;
        default: msg = '识别出错：' + (event.error || '未知错误');
      }
      document.getElementById('voiceHint').textContent = msg;
      toast(msg, 'error');
      resetVoiceUI();
    };

    speechRecognition.onend = () => {
      resetVoiceUI();
      const textArea = document.getElementById('voiceTextResult');
      if (speechFinalText && !textArea.value.startsWith('[')) {
        document.getElementById('voiceHint').textContent = '识别完成，可以编辑后保存';
      }
    };

    hintEl.textContent = '点击开始语音识别（需要联网，支持中文）';
  } catch(e) {
    hintEl.textContent = '语音识别初始化失败: ' + e.message;
    btnEl.textContent = '暂不可用';
    btnEl.disabled = true;
  }
}

function resetVoiceUI() {
  isRecording = false;
  document.getElementById('voiceIconWrap').classList.remove('recording');
  document.getElementById('btnVoice').textContent = '开始录音';
  document.getElementById('btnVoice').classList.remove('recording');
  document.getElementById('btnVoice').disabled = false;
}

async function toggleVoice() {
  if (isRecording) stopRecording();
  else await startRecording();
}

async function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const msg = isIOS
      ? 'iOS Safari 不支持语音识别，请使用 Chrome 浏览器'
      : '浏览器不支持语音识别，请使用 Chrome 或 Edge';
    toast(msg, 'error');
    return;
  }

  // 如果之前的 recognition 实例已被销毁，重新创建
  if (!speechRecognition) {
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'zh-CN';
    speechRecognition.interimResults = true;
    speechRecognition.continuous = true;
    speechRecognition.maxAlternatives = 1;
    speechRecognition.onstart = () => {
      isRecording = true;
      speechFinalText = '';
      document.getElementById('voiceIconWrap').classList.add('recording');
      document.getElementById('voiceHint').textContent = '正在聆听，请说话…';
      document.getElementById('btnVoice').textContent = '停止识别';
      document.getElementById('btnVoice').classList.add('recording');
    };
    speechRecognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) speechFinalText += transcript;
        else interim += transcript;
      }
      document.getElementById('voiceTextResult').value = speechFinalText + interim;
      document.getElementById('voiceHint').textContent = speechFinalText ? '识别中…（结果可编辑）' : '正在聆听…';
    };
    speechRecognition.onerror = (event) => {
      document.getElementById('voiceHint').textContent = '识别出错：' + (event.error || '未知');
      toast('语音识别错误：' + (event.error || '未知'), 'error');
      resetVoiceUI();
    };
    speechRecognition.onend = () => {
      resetVoiceUI();
      if (speechFinalText) document.getElementById('voiceHint').textContent = '识别完成（Web Speech API）';
    };
  }

  try {
    speechRecognition.start();
    console.log('SpeechRecognition started successfully');
  } catch (e) {
    console.error('SpeechRecognition start error:', e);
    let errMsg = e.message || e.toString();
    // 常见错误处理
    if (errMsg.includes('already started') || e.name === 'InvalidStateError') {
      // 已经启动中，先停止再启动
      try { speechRecognition.stop(); } catch(e2) {}
      setTimeout(() => {
        try { speechRecognition.start(); } catch(e3) {
          toast('启动语音识别失败: ' + e3.message, 'error');
        }
      }, 100);
      return;
    }
    toast('启动语音识别失败: ' + errMsg, 'error');
  }
}

function stopRecording() {
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch (e) {}
  }
  resetVoiceUI();
}

async function submitVoiceNote() {
  const content = document.getElementById('voiceTextResult').value.trim();
  const topicId = document.getElementById('voiceTopicSelect').value;
  if (!content) {
    toast('语音内容为空，请先录音或手动输入', 'error');
    return;
  }
  if (isRecording) stopRecording();
  await saveNote(content, 'voice', topicId);
  document.getElementById('voiceTextResult').value = '';
  speechFinalText = '';
}

// ====== 图片 OCR（Tesseract.js 离线识别） ======
let tesseractWorker = null;
let isOcrRunning = false;
let ocrImageDataUrl = null;   // 保存当前图片 data URL

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;

  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js 未加载，请检查网络连接后刷新页面');
  }

  const progressEl = document.getElementById('ocrProgress');
  progressEl.classList.remove('hidden');
  progressEl.textContent = '正在下载中文语言包（约 12MB，仅首次需要）…';

  // 使用超时 Promise + createWorker，避免网络问题导致永久卡住
  const WORKER_TIMEOUT_MS = 120000; // 2 分钟超时

  // 创建超时 Promise
  const timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() {
      reject(new Error('语言包下载超时（超过 2 分钟），请检查网络后重试'));
    }, WORKER_TIMEOUT_MS);
  });

  try {
    tesseractWorker = await Promise.race([
      Tesseract.createWorker(['chi_sim', 'eng'], 1, {
        // unpkg CDN（国内可访问），302 重定向后由 Cloudflare 缓存加速
        // 注意：langPath 只支持字符串，不支持函数（Tesseract.js v5 内部会用 new URL() 处理）
        langPath: 'https://unpkg.com/@tesseract.js-data/',
        corePath: 'https://unpkg.com/tesseract.js-core@5.0.0/',
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const pct = Math.round(m.progress * 100);
            progressEl.textContent = `识别中… ${pct}%`;
          } else if (m.status === 'loading language traineddata') {
            progressEl.textContent = '加载语言模型…';
          } else if (m.status === 'loading tesseract core') {
            progressEl.textContent = '加载 Tesseract 核心引擎…';
          } else if (m.status === 'initializing tesseract') {
            progressEl.textContent = '初始化引擎…';
          } else if (m.status === 'initialized tesseract') {
            progressEl.textContent = '引擎就绪，开始识别…';
          } else if (m.status === 'downloading') {
            progressEl.textContent = `下载中… ${Math.round(m.progress * 100)}%`;
          }
        }
      }),
      timeoutPromise
    ]);
    progressEl.classList.add('hidden');
    return tesseractWorker;
  } catch (e) {
    progressEl.classList.add('hidden');
    tesseractWorker = null;
    throw new Error('Tesseract 引擎初始化失败: ' + e.message);
  }
}

/** 图片预处理：将大图缩放到合适尺寸以提升 OCR 速度和准确率 */
function preprocessImageForOcr(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      maxDim = maxDim || 2000;
      let w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim) { resolve(dataUrl); return; }
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

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
  if (!allowed.includes(file.type)) { toast('不支持的图片格式，请使用 PNG/JPG/BMP/WebP', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('图片过大，请选择 20MB 以内的图片', 'error'); return; }

  // 先用 Promise 等待 FileReader 完成，确保 ocrImageDataUrl 已赋值
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

  ocrImageDataUrl = dataUrl;
  document.getElementById('ocrPreviewImg').src = ocrImageDataUrl;

  // 显示结果区域
  document.getElementById('imageDropZone').style.display = 'none';
  document.getElementById('ocrResult').classList.remove('hidden');
  document.getElementById('ocrMethodBadge').textContent = 'Tesseract.js';
  document.getElementById('ocrTextEdit').value = '';
  document.getElementById('ocrTextEdit').placeholder = '正在识别图片中的文字…';

  // 开始 OCR 识别
  if (isOcrRunning) {
    toast('正在识别上一张图片，请稍候', 'error');
    return;
  }
  await doOcr();
}

/** 独立的 OCR 执行函数，支持重试 */
async function doOcr() {
  if (!ocrImageDataUrl) { toast('请先上传图片', 'error'); return; }
  if (isOcrRunning) return;
  isOcrRunning = true;

  const progressEl = document.getElementById('ocrProgress');
  const textEdit = document.getElementById('ocrTextEdit');
  const badge = document.getElementById('ocrMethodBadge');

  try {
    // 预处理：大图缩放
    progressEl.classList.remove('hidden');
    progressEl.textContent = '预处理图片…';
    const processedUrl = await preprocessImageForOcr(ocrImageDataUrl, 2000);
    document.getElementById('ocrPreviewImg').src = processedUrl;

    const worker = await getTesseractWorker();
    progressEl.classList.remove('hidden');
    progressEl.textContent = '识别中…';

    // 给识别步骤也加超时（60 秒）
    const recognizeTimeout = new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error('识别超时（60 秒），图片可能过大或复杂，请尝试裁剪后重试'));
      }, 60000);
    });
    const recognizeResult = await Promise.race([
      worker.recognize(processedUrl),
      recognizeTimeout
    ]);
    // Tesseract.js v5: recognize() 返回 { data: { text, confidence, ... } }
    const result = (recognizeResult.data.text || '').trim();
    const confVal = (typeof recognizeResult.data.confidence === 'number') ? recognizeResult.data.confidence : 0;
    if (result) {
      textEdit.value = result;
      textEdit.placeholder = 'OCR 识别完成，可以编辑…';
      const confPct = confVal > 0 ? ` · 置信度 ${Math.round(confVal)}%` : '';
      badge.textContent = `Tesseract.js · ${result.length} 字${confPct}`;
      toast(`OCR 识别完成，${result.length} 字`, 'success');
    } else {
      textEdit.value = '';
      textEdit.placeholder = '未能识别到文字，请尝试更清晰的图片或手动输入…';
      badge.textContent = 'Tesseract.js · 未识别到文字';
      toast('未识别到文字，请尝试更清晰的图片', 'error');
    }
  } catch (e) {
    console.error('OCR error:', e);
    textEdit.value = '';
    textEdit.placeholder = 'OCR 识别失败，请重试或手动输入…';
    badge.textContent = '识别失败';
    toast('OCR 识别失败: ' + e.message, 'error');
  } finally {
    isOcrRunning = false;
    progressEl.classList.add('hidden');
  }
}

/** 重试 OCR */
async function retryOcr() {
  await doOcr();
}

function resetOcr() {
  ocrImageDataUrl = null;
  document.getElementById('imageDropZone').style.display = '';
  document.getElementById('ocrResult').classList.add('hidden');
  document.getElementById('imageFileInput').value = '';
  document.getElementById('ocrTextEdit').value = '';
  document.getElementById('ocrProgress').classList.add('hidden');
  document.getElementById('ocrMethodBadge').textContent = 'Tesseract.js';
}

async function submitOcrNote() {
  const content = document.getElementById('ocrTextEdit').value.trim();
  const topicId = document.getElementById('ocrTopicSelect').value;
  const toMindmap = document.getElementById('ocrToMindmap').checked;
  if (!content) { toast('请先上传图片并等待 OCR 识别完成', 'error'); return; }
  // 保存时附带图片数据
  const note = await saveNote(content, 'ocr', topicId, ocrImageDataUrl);
  // 如果选择了归类到思维导图
  if (toMindmap && topicId && note) {
    try {
      await add('mindmap_nodes', {
        topicId: parseInt(topicId),
        parentId: null,
        label: '📷 ' + (note.summary || content.slice(0, 20)),
        orderIdx: 0
      });
      toast('已同时归类到思维导图', 'success');
    } catch(e) { /* 静默失败 */ }
  }
  resetOcr();
}

// ====== 仅上传图片 ======
let imageOnlyDataUrl = null;

function initImageOnlyDrop() {
  const zone = document.getElementById('imageOnlyDropZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processImageOnlyFile(file);
  });
}

function handleImageOnlyUpload(event) {
  const file = event.target.files[0];
  if (file) processImageOnlyFile(file);
}

function processImageOnlyFile(file) {
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'];
  if (!allowed.includes(file.type)) { toast('不支持的图片格式', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('图片过大，请选择 20MB 以内的图片', 'error'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    imageOnlyDataUrl = e.target.result;
    document.getElementById('imageOnlyPreviewImg').src = imageOnlyDataUrl;
  };
  reader.readAsDataURL(file);

  document.getElementById('imageOnlyDropZone').style.display = 'none';
  document.getElementById('imageOnlyResult').classList.remove('hidden');
  document.getElementById('imageOnlyTitle').value = '';
  setTimeout(() => document.getElementById('imageOnlyTitle').focus(), 100);
}

function resetImageOnly() {
  imageOnlyDataUrl = null;
  document.getElementById('imageOnlyDropZone').style.display = '';
  document.getElementById('imageOnlyResult').classList.add('hidden');
  document.getElementById('imageOnlyFileInput').value = '';
}

async function submitImageOnly() {
  if (!imageOnlyDataUrl) { toast('请先上传图片', 'error'); return; }
  const title = document.getElementById('imageOnlyTitle').value.trim();
  const topicId = document.getElementById('imageOnlyTopicSelect').value;
  try {
    await apiCreateImage({
      title: title || '未命名图片',
      imageData: imageOnlyDataUrl,
      topicId: topicId ? parseInt(topicId) : null
    });
    toast('图片已保存到图库', 'success');
    resetImageOnly();
    await loadStats();
    await loadTopics();
  } catch(e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

// ====== 图库视图 ======
async function loadGallery(topicId) {
  const grid = document.getElementById('galleryGrid');
  const emptyEl = document.getElementById('galleryEmpty');
  try {
    const images = await apiGetImages(topicId);
    if (!images || images.length === 0) {
      grid.innerHTML = '';
      grid.appendChild(emptyEl);
      emptyEl.style.display = 'flex';
      return;
    }
    emptyEl.style.display = 'none';
    let html = '<div class="gallery-photos">';
    images.forEach(img => {
      const topic = topics.find(t => t.id === img.topicId);
      html += `<div class="gallery-card">
        <div class="gallery-card-img-wrap">
          <img src="${img.imageData || ''}" alt="${escapeHtml(img.title || '')}" loading="lazy">
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-title">${escapeHtml(img.title || '未命名')}</span>
          <div class="gallery-card-meta">
            <span>${formatDate(img.createdAt)}</span>
            ${topic ? `<span class="note-card-topic" style="background:${topic.color}">${escapeHtml(topic.name)}</span>` : ''}
          </div>
          <div class="gallery-card-actions">
            <button class="btn-outline btn-sm" onclick="imageToMindmap(${img.id})">归类到导图</button>
            <button class="btn-outline btn-sm" onclick="imageToOcr(${img.id})">OCR 识别</button>
            <button class="btn-danger btn-sm" onclick="deleteGalleryImage(${img.id})">删除</button>
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
    grid.innerHTML = html;
  } catch(e) {
    grid.innerHTML = '<div class="empty-state"><p>加载图库失败</p></div>';
  }
}

async function deleteGalleryImage(id) {
  if (!confirm('确定删除这张图片？')) return;
  await apiDeleteImage(id);
  await loadGallery(currentTopicId);
  await loadStats();
  toast('已删除');
}

async function imageToMindmap(imageId) {
  if (!currentTopicId) { toast('请先选择一个主题', 'error'); return; }
  try {
    const img = await getById('images', imageId);
    if (!img) { toast('图片不存在', 'error'); return; }
    const label = img.title || '图片';
    await add('mindmap_nodes', {
      topicId: currentTopicId,
      parentId: null,
      label: '📷 ' + label,
      orderIdx: 0
    });
    toast('已归类到思维导图', 'success');
    showView('mindmap');
  } catch(e) {
    toast('归类失败: ' + e.message, 'error');
  }
}

async function imageToOcr(imageId) {
  try {
    const img = await getById('images', imageId);
    if (!img || !img.imageData) { toast('图片数据不存在', 'error'); return; }
    switchInputMode('image');
    document.getElementById('imageDropZone').style.display = 'none';
    document.getElementById('ocrResult').classList.remove('hidden');
    document.getElementById('ocrPreviewImg').src = img.imageData;
    ocrImageDataUrl = img.imageData;
    document.getElementById('ocrMethodBadge').textContent = 'Tesseract.js';
    document.getElementById('ocrTextEdit').value = '';
    document.getElementById('ocrTextEdit').placeholder = '正在识别图片中的文字…';
    await doOcr();
  } catch(e) {
    toast('OCR 失败: ' + e.message, 'error');
  }
}

// ====== 通用保存笔记 ======
async function saveNote(content, source, topicId, imageDataUrl) {
  try {
    const note = await apiCreateNote({
      content,
      source,
      topicId: topicId ? parseInt(topicId) : null,
      imageData: imageDataUrl || null
    });
    await loadNotes(currentTopicId);
    await loadStats();
    await loadTopics();
    toast(`想法已保存${note.summary ? '：' + note.summary : ''}`, 'success');
    return note;
  } catch(e) {
    toast('保存失败: ' + e.message, 'error');
    return null;
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
  const topic = topics.find(t => t.id === note.topicId);
  document.getElementById('noteDetailMeta').innerHTML =
    `来源：${note.source === 'voice' ? '语音' : note.source === 'ocr' ? '图片OCR' : '文字'} · 
     创建于 ${formatDate(note.createdAt)} ${formatTime(note.createdAt)}` +
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
    const note = await apiUpdateNote(currentNoteId, { content });
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
  await apiDeleteNote(currentNoteId);
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
  const viewEl = document.getElementById(`view${view.charAt(0).toUpperCase() + view.slice(1)}`);
  if (viewEl) viewEl.classList.add('active');
  if (view === 'mindmap') loadMindmap(currentTopicId);
  if (view === 'gallery') loadGallery(currentTopicId);
  if (view === 'notes') loadNotes(currentTopicId);
}

// ====== 思维导图（可编辑交互模式） ======
let mmSelectedNode = null;
let mmEditMode = null;
let mmEditParentId = null;
let mmTopicData = null;
let apMode = 'write';
let apSelectedNoteId = null;

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
    const data = await apiGetMindmap(topicId);
    mmTopicData = data;
    mmSelectedNode = null;
    titleEl.textContent = data.topic.name + ' — 思维导图';
    subtitleEl.textContent = '共 ' + data.note_count + ' 条想法 · 点击节点编辑';

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
    svgEl.style.display = 'none';
    treeEl.style.display = 'block';
    renderMmTree(data, treeEl);

  } catch(e) {
    toast('思维导图加载失败: ' + e.message, 'error');
  }
}

function renderMmTree(data, treeEl) {
  const nodes = data.nodes || [];
  treeEl.innerHTML = '';

  const rootWrap = document.createElement('div');
  rootWrap.className = 'mm-node-wrap';

  const rootNode = createMmNode(data.topic.name, null, true, 'root');
  rootWrap.appendChild(rootNode);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'mm-children';

  if (nodes.length > 0) {
    nodes.forEach(n => childrenContainer.appendChild(buildNodeTree(n)));
  }
  childrenContainer.appendChild(createAddBtn(null));
  rootWrap.appendChild(childrenContainer);
  treeEl.appendChild(rootWrap);
}

function buildNodeTree(node) {
  const wrap = document.createElement('div');
  wrap.className = 'mm-child-row';
  wrap.setAttribute('data-node-id', node.id);

  const nodeEl = createMmNode(node.label, node.id, false, 'child');
  wrap.appendChild(nodeEl);

  if (node.children && node.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'mm-children';
    node.children.forEach(child => childrenContainer.appendChild(buildNodeTree(child)));
    childrenContainer.appendChild(createAddBtn(node.id));
    wrap.appendChild(childrenContainer);
  }
  return wrap;
}

function createMmNode(label, nodeId, isRoot, type) {
  const el = document.createElement('div');
  el.className = 'mm-node' + (isRoot ? ' root-node' : '');
  el.setAttribute('data-node-id', nodeId || 'root');
  el.title = label;

  const toggle = document.createElement('button');
  toggle.className = 'mm-node-toggle empty';
  toggle.innerHTML = '▾';
  toggle.onclick = (e) => {
    e.stopPropagation();
    toggleMmNode(el);
  };
  el.appendChild(toggle);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'mm-node-label';
  labelSpan.textContent = label;
  el.appendChild(labelSpan);

  el.onclick = (e) => {
    e.stopPropagation();
    selectMmNode(el, nodeId, label, isRoot);
  };

  el.ondblclick = (e) => {
    e.stopPropagation();
    if (!isRoot) {
      selectMmNode(el, nodeId, label, isRoot);
      mmEditNode();
    }
  };

  // 移动端长按删除
  let longPressTimer = null;
  el.addEventListener('touchstart', (e) => {
    if (isRoot) return;
    longPressTimer = setTimeout(() => {
      selectMmNode(el, nodeId, label, isRoot);
      if (confirm('长按删除节点「' + label + '」及其所有子节点？')) {
        mmDeleteNodeDirect(nodeId);
      }
    }, 800);
  });
  el.addEventListener('touchend', () => clearTimeout(longPressTimer));
  el.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  el.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectMmNode(el, nodeId, label, isRoot);
    if (!isRoot) showMmContextMenu(e);
  };

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
  el.ondragleave = () => el.classList.remove('drag-over');
  el.ondrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');
    const fromId = parseInt(e.dataTransfer.getData('text/plain'));
    const toId = nodeId;
    if (fromId === toId) return;
    try {
      // 拖拽移动到目标节点作为子节点
      const fromNode = await getById('mindmap_nodes', fromId);
      if (fromNode) {
        fromNode.parentId = toId;
        fromNode.orderIdx = 0;
        await put('mindmap_nodes', fromNode);
      }
      loadMindmap(currentTopicId);
      toast('节点已移动');
    } catch(err) {
      toast('移动失败: ' + err.message, 'error');
    }
  };

  return el;
}

function selectMmNode(el, nodeId, label, isRoot) {
  document.querySelectorAll('.mm-node.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');
  mmSelectedNode = isRoot ? null : { id: nodeId, label, el };
}

function toggleMmNode(nodeEl) {
  nodeEl.classList.toggle('collapsed');
  const toggle = nodeEl.querySelector('.mm-node-toggle');
  toggle.textContent = nodeEl.classList.contains('collapsed') ? '▸' : '▾';
}

function mmAddChild() {
  if (!mmSelectedNode) { toast('请先选中一个节点', 'error'); return; }
  mmEditMode = 'create_child';
  mmEditParentId = mmSelectedNode.id;
  document.getElementById('mmModalTitle').textContent = '添加子节点';
  document.getElementById('mmNodeLabel').value = '';
  openModal('modalMmNode');
  document.getElementById('mmNodeLabel').focus();
}

function mmAddSibling() {
  if (!mmSelectedNode) { toast('请先选中一个节点', 'error'); return; }
  mmEditMode = 'create_sibling';
  mmEditParentId = mmSelectedNode.id;
  document.getElementById('mmModalTitle').textContent = '添加同级节点';
  document.getElementById('mmNodeLabel').value = '';
  openModal('modalMmNode');
  document.getElementById('mmNodeLabel').focus();
}

function mmEditNode() {
  if (!mmSelectedNode) { toast('请先选中一个节点', 'error'); return; }
  mmEditMode = 'edit';
  mmEditParentId = mmSelectedNode.id;
  document.getElementById('mmModalTitle').textContent = '编辑节点';
  document.getElementById('mmNodeLabel').value = mmSelectedNode.label;
  openModal('modalMmNode');
  document.getElementById('mmNodeLabel').focus();
}

async function mmSaveNode() {
  const label = document.getElementById('mmNodeLabel').value.trim();
  if (!label) { toast('节点文字不能为空', 'error'); return; }

  try {
    if (mmEditMode === 'create_child') {
      await add('mindmap_nodes', {
        topicId: currentTopicId,
        parentId: mmEditParentId,
        label: label,
        orderIdx: 0
      });
      toast('子节点已添加', 'success');
    } else if (mmEditMode === 'create_sibling') {
      // 查找同级节点的 parentId
      let parentId = null;
      if (mmEditParentId !== null) {
        try {
          const data = await apiGetMindmap(currentTopicId);
          const allNodes = flattenNodes(data.nodes);
          const targetNode = allNodes.find(n => n.id === mmEditParentId);
          if (targetNode) parentId = targetNode.parentId;
        } catch(e) {}
      }
      await add('mindmap_nodes', {
        topicId: currentTopicId,
        parentId: parentId,
        label: label,
        orderIdx: 0
      });
      toast('同级节点已添加', 'success');
    } else if (mmEditMode === 'edit') {
      const node = await getById('mindmap_nodes', mmEditParentId);
      if (node) {
        node.label = label;
        await put('mindmap_nodes', node);
      }
      toast('节点已更新', 'success');
    }
    closeModal('modalMmNode');
    mmSelectedNode = null;
    loadMindmap(currentTopicId);
  } catch(err) {
    toast('操作失败: ' + err.message, 'error');
  }
}

async function mmDeleteNode() {
  if (!mmSelectedNode) { toast('请先选中一个节点', 'error'); return; }
  if (!confirm('确定删除节点「' + mmSelectedNode.label + '」及其所有子节点？')) return;
  await mmDeleteNodeDirect(mmSelectedNode.id);
  mmSelectedNode = null;
  loadMindmap(currentTopicId);
}

/** 直接按 ID 删除节点（无需选中状态） */
async function mmDeleteNodeDirect(nodeId) {
  try {
    const data = await apiGetMindmap(currentTopicId);
    const allNodes = flattenNodes(data.nodes);
    const deleteIds = [nodeId];
    const collectChildren = (parentId) => {
      allNodes.forEach(n => {
        if (n.parentId === parentId) {
          deleteIds.push(n.id);
          collectChildren(n.id);
        }
      });
    };
    collectChildren(nodeId);
    for (const id of deleteIds) {
      await del('mindmap_nodes', id);
    }
    mmSelectedNode = null;
    loadMindmap(currentTopicId);
    toast(`已删除 ${deleteIds.length} 个节点`, 'success');
  } catch(err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

function showMmContextMenu(e) {
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
      eval(item.action);
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 50);
}

function flattenNodes(nodes) {
  let result = [];
  nodes.forEach(n => {
    result.push({ id: n.id, parentId: n.parentId });
    if (n.children && n.children.length > 0) {
      result = result.concat(flattenNodes(n.children));
    }
  });
  return result;
}

function createAddBtn(parentId) {
  const btn = document.createElement('button');
  btn.className = 'mm-add-btn';
  btn.innerHTML = '+';
  btn.title = '添加节点';
  btn.onclick = (e) => {
    e.stopPropagation();
    mmEditMode = 'create_child';
    mmEditParentId = parentId;
    mmSelectedNode = { id: parentId, label: '', el: null };
    document.getElementById('mmModalTitle').textContent = '添加节点';
    document.getElementById('mmNodeLabel').value = '';
    openModal('modalMmNode');
    document.getElementById('mmNodeLabel').focus();
  };
  return btn;
}

// 点击思维导图空白区域取消选中
document.addEventListener('click', function(e) {
  if (e.target.closest('#viewMindmap') && !e.target.closest('.mm-node') && !e.target.closest('.mm-context-menu') && !e.target.closest('.mm-add-btn')) {
    document.querySelectorAll('.mm-node.selected').forEach(n => n.classList.remove('selected'));
    mmSelectedNode = null;
  }
});

// ====== 思维导图自动排版 ======
function toggleAutoParse() {
  if (!currentTopicId) { toast('请先选择一个主题', 'error'); return; }
  const panel = document.getElementById('autoParsePanel');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (!isHidden) return;
  switchApMode('write');
  document.getElementById('apTextInput').value = '';
  document.getElementById('apOverwrite').checked = false;
  apSelectedNoteId = null;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('apTextInput').focus(), 200);
}

function switchApMode(mode) {
  apMode = mode;
  document.querySelectorAll('.ap-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.apMode === mode));
  document.getElementById('apPanelWrite').classList.toggle('hidden', mode !== 'write');
  document.getElementById('apPanelImport').classList.toggle('hidden', mode !== 'import');
  document.getElementById('btnApClear').style.display = (mode === 'write') ? '' : 'none';
  if (mode === 'import') loadImportableNotes();
  else setTimeout(() => document.getElementById('apTextInput').focus(), 100);
}

async function loadImportableNotes() {
  const listEl = document.getElementById('apImportList');
  if (!currentTopicId) {
    listEl.innerHTML = '<div class="ap-import-empty">请先选择一个主题</div>';
    return;
  }
  try {
    const importNotes = await apiGetNotes(currentTopicId);
    if (!importNotes || importNotes.length === 0) {
      listEl.innerHTML = '<div class="ap-import-empty">该主题下暂无笔记，请先在笔记列表中添加一些想法</div>';
      return;
    }
    apSelectedNoteId = null;
    let html = '';
    importNotes.forEach(note => {
      const sourceLabel = { text: '文字', voice: '语音', ocr: 'OCR' }[note.source] || '文字';
      html += `<div class="ap-import-item" data-note-id="${note.id}" onclick="selectImportNote(${note.id}, this)">
        <input type="radio" class="ap-import-radio" name="apImportNote" value="${note.id}">
        <div>
          <div class="ap-import-content">${escapeHtml(note.content)}</div>
          <div class="ap-import-meta">${sourceLabel} · ${formatDate(note.createdAt)} · ${escapeHtml(note.summary || '')}</div>
        </div>
      </div>`;
    });
    listEl.innerHTML = html;
  } catch(e) {
    listEl.innerHTML = '<div class="ap-import-empty">加载笔记失败</div>';
  }
}

function selectImportNote(noteId, el) {
  apSelectedNoteId = noteId;
  document.querySelectorAll('.ap-import-item').forEach(item => item.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input[type="radio"]').checked = true;
}

function clearApText() {
  document.getElementById('apTextInput').value = '';
  document.getElementById('apTextInput').focus();
}

async function doAutoParse() {
  if (!currentTopicId) { toast('请先选择一个主题', 'error'); return; }
  let text = '';
  if (apMode === 'write') {
    text = document.getElementById('apTextInput').value.trim();
  } else if (apMode === 'import') {
    if (!apSelectedNoteId) { toast('请选择一条笔记', 'error'); return; }
    try {
      const importNotes = await apiGetNotes(currentTopicId);
      const note = importNotes.find(n => n.id === apSelectedNoteId);
      if (!note) { toast('笔记不存在', 'error'); return; }
      text = note.content.trim();
    } catch(e) {
      toast('获取笔记内容失败: ' + e.message, 'error');
      return;
    }
  }
  if (!text) { toast('请输入或选择要排版的内容', 'error'); return; }

  const overwrite = document.getElementById('apOverwrite').checked;
  if (!overwrite && mmTopicData && mmTopicData.nodes && mmTopicData.nodes.length > 0) {
    if (!confirm('当前主题已有思维导图节点，是否覆盖？\n\n选择"确定"将覆盖已有节点，选择"取消"将追加到现有结构中。')) {
      // 追加模式
    }
  }

  const btn = document.getElementById('btnAutoParse');
  const btnText = document.getElementById('btnAutoParseText');
  const btnSpinner = document.getElementById('btnAutoParseSpinner');
  btn.disabled = true;
  btnText.textContent = '解析中…';
  btnSpinner.classList.remove('hidden');

  try {
    const result = await apiAutoParseMindmap(currentTopicId, text, overwrite);
    btn.disabled = false;
    btnText.textContent = '生成思维导图';
    btnSpinner.classList.add('hidden');
    document.getElementById('autoParsePanel').classList.add('hidden');
    await loadMindmap(currentTopicId);
    toast('成功生成 ' + result.length + ' 个节点', 'success');
  } catch(e) {
    btn.disabled = false;
    btnText.textContent = '生成思维导图';
    btnSpinner.classList.add('hidden');
    toast('自动排版失败: ' + e.message, 'error');
  }
}

// ====== 工具函数 ======
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

function toast(msg, type) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastIn 0.3s reverse';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(str) {
  if (!str) return '';
  const d = new Date(str);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Enter键确认主题创建
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('newTopicName');
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTopic();
  });
});
