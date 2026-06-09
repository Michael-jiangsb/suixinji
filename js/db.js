/**
 * 随心记 - IndexedDB 数据层
 * 替代原 SQLite 数据库，所有数据存储在浏览器 IndexedDB 中
 * 数据库名: suixinji-db 版本: 1
 */

const DB_NAME = 'suixinji-db';
const DB_VERSION = 2;

let dbPromise = null;

/** 打开数据库（懒加载，返回 Promise<IDBDatabase>） */
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;

      // 主题表
      if (!db.objectStoreNames.contains('topics')) {
        const os = db.createObjectStore('topics', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_updated', 'updatedAt', { unique: false });
      }
      // 笔记表
      if (!db.objectStoreNames.contains('notes')) {
        const os = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_topic', 'topicId', { unique: false });
        os.createIndex('by_created', 'createdAt', { unique: false });
      } else if (oldVersion < 2) {
        // 升级：确保 notes 有 imageData 索引（v2 新增）
        const tx = e.target.transaction;
        const store = tx.objectStore('notes');
        if (!store.indexNames.contains('by_topic')) {
          store.createIndex('by_topic', 'topicId', { unique: false });
        }
        if (!store.indexNames.contains('by_created')) {
          store.createIndex('by_created', 'createdAt', { unique: false });
        }
      }
      // 图片存储表（v2 新增，用于仅上传图片功能）
      if (!db.objectStoreNames.contains('images')) {
        const os = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_topic', 'topicId', { unique: false });
        os.createIndex('by_created', 'createdAt', { unique: false });
      }
      // 思维导图节点表
      if (!db.objectStoreNames.contains('mindmap_nodes')) {
        const os = db.createObjectStore('mindmap_nodes', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_topic', 'topicId', { unique: false });
        os.createIndex('by_parent', 'parentId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 通用：在事务中执行请求，返回 Promise */
function txPromise(storeName, mode, callback) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = callback(store, tx);
      // 如果 callback 返回了请求对象，等它完成
      if (result && typeof result.onsuccess !== 'undefined') {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      }
    });
  });
}

/** 获取所有记录 */
function getAll(storeName) {
  return txPromise(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

/** 按索引查询 */
function getByIndex(storeName, indexName, value) {
  return txPromise(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const idx = store.index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

/** 新增记录，返回带 id 的对象 */
function add(storeName, obj) {
  return txPromise(storeName, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.add(obj);
      req.onsuccess = () => resolve({ ...obj, id: req.result });
      req.onerror = () => reject(req.error);
    });
  });
}

/** 更新记录 */
function put(storeName, obj) {
  return txPromise(storeName, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    });
  });
}

/** 删除记录 */
function del(storeName, id) {
  return txPromise(storeName, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
}

/** 获取单条记录 */
function getById(storeName, id) {
  return txPromise(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

// ==================== 主题 API ====================

function apiGetTopics() {
  return getAll('topics').then(topics => {
    // 统计每个主题的笔记数
    return Promise.all(topics.map(t => {
      return getByIndex('notes', 'by_topic', t.id).then(notes => {
        t.note_count = notes.length;
        return t;
      });
    })).then(() => topics.sort((a, b) => {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    }));
  });
}

function apiCreateTopic(data) {
  const now = new Date().toISOString();
  const obj = {
    name: data.name,
    color: data.color || '#4A90D9',
    createdAt: now,
    updatedAt: now
  };
  return add('topics', obj);
}

function apiUpdateTopic(id, data) {
  return getById('topics', id).then(topic => {
    if (!topic) throw new Error('主题不存在');
    topic.name = data.name !== undefined ? data.name : topic.name;
    topic.color = data.color !== undefined ? data.color : topic.color;
    topic.updatedAt = new Date().toISOString();
    return put('topics', topic);
  });
}

function apiDeleteTopic(id) {
  // 删除主题下的所有笔记
  return getByIndex('notes', 'by_topic', id).then(notes => {
    const deletes = notes.map(n => del('notes', n.id));
    return Promise.all(deletes);
  }).then(() => {
    // 删除主题下的思维导图节点
    return getByIndex('mindmap_nodes', 'by_topic', id).then(nodes => {
      const deletes = nodes.map(n => del('mindmap_nodes', n.id));
      return Promise.all(deletes);
    });
  }).then(() => {
    return del('topics', id);
  });
}

// ==================== 笔记 API ====================

function apiGetNotes(topicId) {
  if (topicId) {
    return getByIndex('notes', 'by_topic', topicId);
  }
  return getAll('notes');
}

function apiCreateNote(data) {
  const now = new Date().toISOString();
  const summary = simpleSummarize(data.content);
  const obj = {
    topicId: data.topicId || null,
    content: data.content,
    summary: summary,
    source: data.source || 'text',
    imagePath: data.imagePath || null,
    imageData: data.imageData || null,
    ocrText: data.ocrText || null,
    createdAt: now,
    updatedAt: now
  };
  return add('notes', obj).then(note => {
    // 更新主题 updatedAt
    if (note.topicId) {
      return apiUpdateTopic(note.topicId, {}).then(() => note).catch(() => note);
    }
    return note;
  });
}

function apiUpdateNote(id, data) {
  return getById('notes', id).then(note => {
    if (!note) throw new Error('笔记不存在');
    if (data.content !== undefined) {
      note.content = data.content;
      note.summary = simpleSummarize(data.content);
      note.updatedAt = new Date().toISOString();
    }
    return put('notes', note);
  });
}

function apiDeleteNote(id) {
  return del('notes', id);
}

// ==================== 统计 API ====================

function apiGetStats() {
  return Promise.all([
    getAll('notes').then(notes => notes.length),
    getAll('topics').then(topics => topics.length),
    getAll('notes').then(notes => {
      const today = new Date().toISOString().slice(0, 10);
      return notes.filter(n => n.createdAt && n.createdAt.startsWith(today)).length;
    })
  ]).then(([total_notes, total_topics, today_notes]) => ({
    total_notes, total_topics, today_notes
  }));
}

// ==================== 思维导图 API ====================

function apiGetMindmap(topicId) {
  return Promise.all([
    getById('topics', topicId),
    getByIndex('notes', 'by_topic', topicId),
    getByIndex('mindmap_nodes', 'by_topic', topicId)
  ]).then(async ([topic, notes, rawNodes]) => {
    if (!topic) throw new Error('主题不存在');

    // 如果思维导图没有节点但该主题有笔记，自动从笔记生成默认节点
    let nodes = rawNodes;
    if ((!nodes || nodes.length === 0) && notes && notes.length > 0) {
      const createdNodes = [];
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const created = await add('mindmap_nodes', {
          topicId: topicId,
          parentId: null,
          label: (n.summary || n.content.slice(0, 30)),
          orderIdx: i
        });
        createdNodes.push(created);
      }
      nodes = createdNodes;
    }

    // 构建树形结构
    const nodeDict = {};
    const tree = [];
    nodes.forEach(n => {
      const nd = { ...n, children: [] };
      nodeDict[n.id] = nd;
    });
    nodes.forEach(n => {
      const nd = nodeDict[n.id];
      if (n.parentId && nodeDict[n.parentId]) {
        nodeDict[n.parentId].children.push(nd);
      } else {
        // 不重复添加
        if (!tree.includes(nd)) tree.push(nd);
      }
    });
    // 生成 Markdown
    const lines = [`# ${topic.name}`];
    notes.forEach(note => {
      const content = note.content;
      const summary = note.summary || content.slice(0, 20);
      const icon = note.source === 'voice' ? '🎤' : note.source === 'ocr' ? '📷' : '📝';
      lines.push(`## ${icon} ${summary}`);
      const paras = content.split('\n').filter(p => p.trim()).slice(0, 3);
      paras.forEach(p => {
        const text = p.length > 40 ? p.slice(0, 40) + '…' : p;
        lines.push(`- ${text}`);
      });
    });

    return {
      topic,
      markdown: lines.join('\n'),
      nodes: tree,
      note_count: notes.length
    };
  });
}

/** 递归创建节点树 */
function _createNodeRecursive(conn, topicId, node, parentId, orderIdx) {
  const newNode = {
    topicId: topicId,
    parentId: parentId || null,
    label: node.label,
    orderIdx: orderIdx
  };
  return add('mindmap_nodes', newNode).then(created => {
    const createdId = created.id;
    if (node.children && node.children.length > 0) {
      const promises = node.children.map((child, i) =>
        _createNodeRecursive(null, topicId, child, createdId, i)
      );
      return Promise.all(promises).then(children => [created, ...children.flat()]);
    }
    return [created];
  });
}

function apiAutoParseMindmap(topicId, text, overwrite) {
  // 解析文本为节点树（复用原 parseTextToNodes 逻辑）
  const nodes = parseTextToNodes(text);

  if (overwrite) {
    // 删除旧节点
    return getByIndex('mindmap_nodes', 'by_topic', topicId).then(oldNodes => {
      const deletes = oldNodes.map(n => del('mindmap_nodes', n.id));
      return Promise.all(deletes);
    }).then(() => _createNodesFromTree(topicId, nodes, null, 0));
  } else {
    return _createNodesFromTree(topicId, nodes, null, 0);
  }
}

function _createNodesFromTree(topicId, nodes, parentId, startOrder) {
  let created = [];
  let promise = Promise.resolve();
  nodes.forEach((node, i) => {
    promise = promise.then(() => {
      const obj = {
        topicId: topicId,
        parentId: parentId || null,
        label: node.label,
        orderIdx: startOrder + i
      };
      return add('mindmap_nodes', obj).then(createdNode => {
        created.push(createdNode);
        if (node.children && node.children.length > 0) {
          return _createNodesFromTree(topicId, node.children, createdNote.id, 0).then(children => {
            created = created.concat(children);
          });
        }
      });
    });
  });
  return promise.then(() => created);
}

// ==================== 文本解析（思维导图自动排版） ====================

function parseTextToNodes(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  const nonEmpty = lines.filter(l => l.trim());

  if (nonEmpty.length === 0) return [];

  // 策略1: Markdown 标题
  if (nonEmpty.some(l => /^#{1,6}\s/.test(l))) {
    return _parseMd(lines);
  }
  // 策略2: 编号列表
  if (nonEmpty.some(l => /^[\d]+[\.\、\)]/.test(l) || /^\([一二三四五六七八九十]+\)/.test(l) || /^[一二三四五六七八九十]+[、．]/.test(l))) {
    return _parseNumbered(nonEmpty);
  }
  // 策略3: 缩进
  if (nonEmpty.some(l => l.startsWith(' ') || l.startsWith('\t'))) {
    return _parseIndent(nonEmpty);
  }
  // 策略4: 符号列表
  if (nonEmpty.some(l => /^[\-\*\+]\s/.test(l))) {
    return _parseBullet(nonEmpty);
  }
  // 策略5: 自然语言
  return _parseNatural(nonEmpty);
}

function _parseMd(lines) {
  const nodes = [];
  const stack = [];
  lines.forEach(l => {
    const m = l.match(/^(#{1,6})\s+(.*)/);
    if (!m) return;
    const level = m[1].length;
    const label = m[2].trim().slice(0, 200);
    const node = { label, children: [] };
    while (stack.length && stack[stack.length - 1][0] >= level) stack.pop();
    if (stack.length) stack[stack.length - 1][1].children.push(node);
    else nodes.push(node);
    stack.push([level, node]);
  });
  return nodes;
}

function _parseNumbered(lines) {
  const nodes = [];
  const stack = [];
  lines.forEach(l => {
    const stripped = l.trim();
    let m = stripped.match(/^([\d]+(?:\.[\d]+)*)[\.\、\)]\s*(.*)/);
    let depth, label;
    if (m) {
      label = m[2].trim().slice(0, 200);
      depth = m[1].split('.').length;
    } else {
      m = stripped.match(/^(\([一二三四五六七八九十]+\))\s*(.*)/);
      if (m) {
        label = m[2].trim().slice(0, 200);
        depth = 1;
      } else {
        m = stripped.match(/^([一二三四五六七八九十]+)[、．]\s*(.*)/);
        if (!m) return;
        label = m[2].trim().slice(0, 200);
        depth = 1;
      }
    }
    const node = { label, children: [] };
    while (stack.length && stack[stack.length - 1][0] >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1][1].children.push(node);
    else nodes.push(node);
    stack.push([depth, node]);
  });
  return nodes;
}

function _parseIndent(lines) {
  const nodes = [];
  const stack = [];
  lines.forEach(l => {
    const stripped = l.trim();
    if (!stripped) return;
    const clean = stripped.replace(/^[\-\*\+]\s+/, '').replace(/^[\d]+[\.\、\)]\s*/, '');
    const label = clean.slice(0, 200);
    const indent = l.length - l.search(/\S/);
    const level = Math.max(0, Math.floor(indent / 2));
    const node = { label, children: [] };
    while (stack.length && stack[stack.length - 1][0] >= level) stack.pop();
    if (stack.length) stack[stack.length - 1][1].children.push(node);
    else nodes.push(node);
    stack.push([level, node]);
  });
  return nodes;
}

function _parseBullet(lines) {
  const nodes = [];
  const stack = [];
  lines.forEach(l => {
    const stripped = l.trim();
    if (!stripped) return;
    const m = stripped.match(/^([\-\*\+])\s+(.*)/);
    if (!m) return;
    const label = m[2].trim().slice(0, 200);
    const indent = l.length - l.search(/\S/);
    const level = Math.max(0, Math.floor(indent / 2)) + 1;
    const node = { label, children: [] };
    while (stack.length && stack[stack.length - 1][0] >= level) stack.pop();
    if (stack.length) stack[stack.length - 1][1].children.push(node);
    else nodes.push(node);
    stack.push([level, node]);
  });
  return nodes;
}

function _parseNatural(lines) {
  const fullText = lines.join(' ');
  const sentences = fullText.split(/[。！？!?\n]/).filter(s => s.trim());
  if (sentences.length <= 1) {
    const parts = fullText.split(/[；;，,]/).filter(s => s.trim());
    if (parts.length <= 1) return [{ label: fullText.slice(0, 200), children: [] }];
    return parts.map(p => ({ label: p.trim().slice(0, 200), children: [] }));
  }
  const main = sentences[0].slice(0, 200);
  const children = sentences.slice(1).map(s => ({ label: s.trim().slice(0, 200), children: [] }));
  return [{ label: main, children }];
}

// ==================== 简易摘要算法 ====================

function simpleSummarize(text) {
  if (!text || !text.trim()) return '';
  text = text.trim();
  text = text.replace(/\s+/g, ' ');
  const sentences = text.split(/[。！？!?\n]/).filter(s => s.trim());
  if (!sentences.length) {
    return text.length > 28 ? text.slice(0, 28) + '…' : text;
  }
  let first = sentences[0];
  if (first.length > 28) return first.slice(0, 28) + '…';
  let summary = first;
  if (summary.length < 8 && sentences.length > 1) {
    const combined = first + '；' + sentences[1];
    summary = combined.length > 28 ? combined.slice(0, 28) + '…' : combined;
  }
  return summary;
}

// ==================== 图片存储 API（v2 新增） ====================

/** 获取某主题下的所有图片 */
function apiGetImages(topicId) {
  if (topicId) {
    return getByIndex('images', 'by_topic', topicId);
  }
  return getAll('images');
}

/** 保存图片 */
function apiCreateImage(data) {
  const now = new Date().toISOString();
  const obj = {
    topicId: data.topicId || null,
    title: data.title || '',
    imageData: data.imageData || null,  // base64 data URL
    ocrText: data.ocrText || '',
    createdAt: now,
    updatedAt: now
  };
  return add('images', obj).then(img => {
    if (img.topicId) {
      return apiUpdateTopic(img.topicId, {}).then(() => img).catch(() => img);
    }
    return img;
  });
}

/** 删除图片 */
function apiDeleteImage(id) {
  return del('images', id);
}

/** 更新图片（OCR文字等） */
function apiUpdateImage(id, data) {
  return getById('images', id).then(img => {
    if (!img) throw new Error('图片不存在');
    if (data.title !== undefined) img.title = data.title;
    if (data.ocrText !== undefined) img.ocrText = data.ocrText;
    img.updatedAt = new Date().toISOString();
    return put('images', img);
  });
}
