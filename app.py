"""
随心记 App - Flask 后端
功能: 想法记录、主题管理、语音输入、OCR图片识别、AI文字总结、思维导图
"""

import os
import json
import sqlite3
import base64
import re
import subprocess
import tempfile
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB
app.config['SECRET_KEY'] = 'suixin-note-app-2026'

DB_PATH = os.path.join(os.path.dirname(__file__), 'suixin.db')

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}

# 模块级别懒加载（避免每次请求重新加载模型）
_whisper_model = None
_easyocr_reader = None


def _get_whisper_model():
    """懒加载 Whisper 模型（base 大小约 139MB，首次加载约 5-10 秒）"""
    global _whisper_model
    if _whisper_model is None:
        import imageio_ffmpeg
        import os as _os
        ffmpeg_dir = _os.path.dirname(imageio_ffmpeg.get_ffmpeg_exe())
        if ffmpeg_dir not in _os.environ.get('PATH', ''):
            _os.environ['PATH'] = ffmpeg_dir + _os.pathsep + _os.environ.get('PATH', '')

        import whisper

        # Monkey-patch load_audio 以使用 imageio-ffmpeg 提供的 ffmpeg
        _original_load_audio = whisper.audio.load_audio

        def _patched_load_audio(file, sr=whisper.audio.SAMPLE_RATE):
            import subprocess as _sp
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            cmd = [
                ffmpeg_exe, "-nostdin", "-threads", "0",
                "-i", file, "-f", "s16le", "-ac", "1",
                "-acodec", "pcm_s16le", "-ar", str(sr), "-"
            ]
            try:
                out = _sp.run(cmd, capture_output=True, check=True).stdout
            except _sp.CalledProcessError as e:
                raise RuntimeError(f"Failed to load audio: {e.stderr.decode()}") from e
            import numpy as np
            return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0

        whisper.audio.load_audio = _patched_load_audio

        _whisper_model = whisper.load_model("base")
    return _whisper_model


def _get_easyocr_reader():
    """懒加载 EasyOCR Reader（首次加载约 10-30 秒，下载约 100MB 模型）"""
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        _easyocr_reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
    return _easyocr_reader


def _ensure_wav_audio(input_path):
    """将任意音频格式转为 Whisper 兼容的 16kHz mono WAV（使用 imageio-ffmpeg 内置 ffmpeg）"""
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    wav_path = input_path + '_converted.wav'
    subprocess.run([
        ffmpeg, '-y', '-i', input_path,
        '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
        wav_path
    ], capture_output=True, check=True)
    return wav_path


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#4A90D9',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER,
            content TEXT NOT NULL,
            summary TEXT,
            source TEXT DEFAULT 'text',
            image_path TEXT,
            ocr_text TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS mindmap_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER NOT NULL,
            parent_id INTEGER,
            label TEXT NOT NULL,
            note_id INTEGER,
            order_idx INTEGER DEFAULT 0,
            FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
        );
    """)
    conn.commit()

    # 插入示例主题
    c.execute("SELECT COUNT(*) FROM topics")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO topics (name, color) VALUES (?, ?)", ("日常灵感", "#4A90D9"))
        c.execute("INSERT INTO topics (name, color) VALUES (?, ?)", ("工作想法", "#7B68EE"))
        conn.commit()

    conn.close()


# ===================== 页面路由 =====================

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ===================== 主题 API =====================

@app.route('/api/topics', methods=['GET'])
def get_topics():
    conn = get_db()
    topics = conn.execute(
        "SELECT t.*, COUNT(n.id) as note_count FROM topics t "
        "LEFT JOIN notes n ON n.topic_id = t.id "
        "GROUP BY t.id ORDER BY t.updated_at DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(t) for t in topics])


@app.route('/api/topics', methods=['POST'])
def create_topic():
    data = request.json
    if not data or not data.get('name', '').strip():
        return jsonify({'error': '主题名称不能为空'}), 400
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO topics (name, color) VALUES (?, ?)",
        (data['name'].strip(), data.get('color', '#4A90D9'))
    )
    topic_id = c.lastrowid
    conn.commit()
    topic = conn.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
    conn.close()
    return jsonify(dict(topic)), 201


@app.route('/api/topics/<int:topic_id>', methods=['PUT'])
def update_topic(topic_id):
    data = request.json
    conn = get_db()
    conn.execute(
        "UPDATE topics SET name=?, color=?, updated_at=datetime('now','localtime') WHERE id=?",
        (data.get('name'), data.get('color', '#4A90D9'), topic_id)
    )
    conn.commit()
    topic = conn.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
    conn.close()
    return jsonify(dict(topic))


@app.route('/api/topics/<int:topic_id>', methods=['DELETE'])
def delete_topic(topic_id):
    conn = get_db()
    conn.execute("DELETE FROM topics WHERE id=?", (topic_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ===================== 笔记 API =====================

@app.route('/api/notes', methods=['GET'])
def get_notes():
    topic_id = request.args.get('topic_id')
    conn = get_db()
    if topic_id:
        notes = conn.execute(
            "SELECT * FROM notes WHERE topic_id=? ORDER BY created_at DESC",
            (topic_id,)
        ).fetchall()
    else:
        notes = conn.execute("SELECT * FROM notes ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([dict(n) for n in notes])


@app.route('/api/notes', methods=['POST'])
def create_note():
    data = request.json
    if not data or not data.get('content', '').strip():
        return jsonify({'error': '内容不能为空'}), 400

    content = data['content'].strip()
    summary = simple_summarize(content)
    topic_id = data.get('topic_id')

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO notes (topic_id, content, summary, source) VALUES (?, ?, ?, ?)",
        (topic_id, content, summary, data.get('source', 'text'))
    )
    note_id = c.lastrowid

    # 更新主题时间
    if topic_id:
        conn.execute(
            "UPDATE topics SET updated_at=datetime('now','localtime') WHERE id=?",
            (topic_id,)
        )
        # 自动在思维导图中为该笔记创建一个节点（如果该主题已有思维导图节点，追加为根节点同级；否则创建默认节点）
        _auto_create_mindmap_node(conn, topic_id, summary or content[:30])

    conn.commit()
    note = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    return jsonify(dict(note)), 201


def _auto_create_mindmap_node(conn, topic_id, label):
    """在思维导图中为该主题的笔记自动创建一个节点"""
    # 检查该主题是否已有思维导图节点
    existing = conn.execute(
        "SELECT COUNT(*) FROM mindmap_nodes WHERE topic_id=?", (topic_id,)
    ).fetchone()[0]

    if existing == 0:
        # 该主题还没有任何思维导图节点，先检查是否有笔记可以用来生成默认结构
        notes = conn.execute(
            "SELECT * FROM notes WHERE topic_id=? ORDER BY created_at ASC", (topic_id,)
        ).fetchall()
        if notes:
            # 为每条笔记创建一个根节点下的子节点
            for i, note in enumerate(notes):
                note_label = note['summary'] or note['content'][:30]
                conn.execute(
                    "INSERT INTO mindmap_nodes (topic_id, parent_id, label, order_idx) VALUES (?, NULL, ?, ?)",
                    (topic_id, note_label, i)
                )
        else:
            # 没有笔记（理论上不会到这里），创建一个空节点
            conn.execute(
                "INSERT INTO mindmap_nodes (topic_id, parent_id, label, order_idx) VALUES (?, NULL, ?, ?)",
                (topic_id, label, 0)
            )
    else:
        # 已有节点，将新笔记作为根节点的子节点追加
        # 找到根节点（parent_id IS NULL 的节点）或直接在顶层创建
        root_nodes = conn.execute(
            "SELECT id FROM mindmap_nodes WHERE topic_id=? AND parent_id IS NULL ORDER BY order_idx ASC",
            (topic_id,)
        ).fetchall()
        # 获取当前最大 order_idx
        max_order = conn.execute(
            "SELECT COALESCE(MAX(order_idx), -1) FROM mindmap_nodes WHERE topic_id=? AND parent_id IS NULL",
            (topic_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO mindmap_nodes (topic_id, parent_id, label, order_idx) VALUES (?, NULL, ?, ?)",
            (topic_id, label, max_order + 1)
        )


@app.route('/api/notes/<int:note_id>', methods=['PUT'])
def update_note(note_id):
    data = request.json
    content = data.get('content', '').strip()
    summary = simple_summarize(content) if content else ''
    conn = get_db()
    conn.execute(
        "UPDATE notes SET content=?, summary=?, updated_at=datetime('now','localtime') WHERE id=?",
        (content, summary, note_id)
    )
    conn.commit()
    note = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    return jsonify(dict(note))


@app.route('/api/notes/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    conn = get_db()
    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ===================== 语音识别 (Whisper) =====================

@app.route('/api/speech-to-text', methods=['POST'])
def speech_to_text():
    """使用 Whisper 本地语音转文字"""
    if 'audio' not in request.files:
        return jsonify({'error': '未上传音频文件'}), 400

    file = request.files['audio']
    if not file or not file.filename:
        return jsonify({'error': '无效的音频文件'}), 400

    # 保存到临时文件
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'wav'
    if ext not in ('wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac', 'wma', 'aac'):
        ext = 'wav'

    with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as tmp:
        file.save(tmp)
        tmp_path = tmp.name

    try:
        # 将音频转为 Whisper 兼容格式（16kHz mono WAV）
        wav_path = _ensure_wav_audio(tmp_path)

        # 使用模块级缓存的 Whisper 模型（避免每次请求重新加载）
        model = _get_whisper_model()
        result = model.transcribe(wav_path, language="zh", fp16=False)

        text = result['text'].strip()
        if not text:
            text = '[未识别到语音内容，请确认录音清晰]'

        # 按段落拆分
        segments = result.get('segments', [])
        paragraphs = [s['text'].strip() for s in segments if s['text'].strip()]

        return jsonify({
            'success': True,
            'text': text,
            'paragraphs': paragraphs if paragraphs else [text],
            'method': 'whisper'
        })
    except ImportError:
        return jsonify({
            'success': False,
            'error': 'Whisper 未安装，请运行: pip install openai-whisper',
            'text': '[Whisper 语音识别未安装]',
            'paragraphs': ['请运行: pip install openai-whisper'],
            'method': 'unavailable'
        })
    except Exception as e:
        return jsonify({'error': f'语音识别失败: {str(e)}'}), 500
    finally:
        # 清理临时文件
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        if 'wav_path' in dir() and os.path.exists(wav_path):
            os.remove(wav_path)


# ===================== OCR 图片识别 (EasyOCR) =====================

@app.route('/api/ocr', methods=['POST'])
def ocr_image():
    """图片OCR识别文字 — 使用 EasyOCR（纯 Python，支持中英文）"""
    if 'image' not in request.files:
        return jsonify({'error': '未上传图片'}), 400

    file = request.files['image']
    if not file or not allowed_file(file.filename):
        return jsonify({'error': '不支持的图片格式，请上传 PNG/JPG/GIF/BMP'}), 400

    filename = secure_filename(file.filename)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_')
    filename = timestamp + filename
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    try:
        # 使用 EasyOCR 进行真正的 OCR 文字识别
        reader = _get_easyocr_reader()
        results = reader.readtext(filepath)

        # 提取所有识别的文字
        all_texts = [item[1] for item in results if item[1].strip()]
        text = '\n'.join(all_texts)

        if not text:
            text = '[图片中未识别到文字，请确认图片清晰且包含文字内容]'

        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        return jsonify({
            'success': True,
            'text': text,
            'paragraphs': paragraphs,
            'image_url': f'/static/uploads/{filename}',
            'filename': filename,
            'method': 'easyocr'
        })
    except ImportError as e:
        return jsonify({
            'success': False,
            'error': 'EasyOCR 未安装，请运行: pip install easyocr',
            'text': '[EasyOCR 未安装]',
            'paragraphs': ['请运行: pip install easyocr'],
            'image_url': f'/static/uploads/{filename}',
            'filename': filename,
            'method': 'unavailable'
        })
    except OSError as e:
        # 网络下载模型失败等IO错误
        error_msg = str(e)
        if 'Download' in error_msg or 'download' in error_msg:
            return jsonify({
                'success': False,
                'error': f'EasyOCR 模型下载失败，请检查网络连接后重试',
                'text': '[OCR模型下载中，请稍后重试]',
                'paragraphs': ['首次使用需下载约100MB的OCR模型，请确保网络畅通后刷新页面重试。'],
                'image_url': f'/static/uploads/{filename}',
                'filename': filename,
                'method': 'easyocr'
            })
        return jsonify({'error': f'OCR识别失败: {error_msg}'}), 500
    except Exception as e:
        return jsonify({'error': f'OCR识别失败: {str(e)}'}), 500


# ===================== AI 总结 =====================

@app.route('/api/summarize', methods=['POST'])
def summarize_text():
    """对文本进行简短总结（不超过30字）"""
    data = request.json
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'error': '文本不能为空'}), 400

    summary = simple_summarize(text)
    return jsonify({'summary': summary, 'original_length': len(text)})


def simple_summarize(text: str) -> str:
    """
    本地简单文本摘要算法（无需外部API）：
    1. 提取第一句有意义的话
    2. 超过30字则截断并加省略号
    """
    if not text or len(text.strip()) == 0:
        return ''
    text = text.strip()
    # 清理多余空白
    text = re.sub(r'\s+', ' ', text)

    # 按句号、感叹号、问号分割取第一句
    sentences = re.split(r'[。！？!?\n]', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        summary = text[:28] + ('…' if len(text) > 28 else '')
        return summary

    first = sentences[0]
    # 超过30字则截断
    if len(first) > 28:
        summary = first[:28] + '…'
    else:
        summary = first
        # 如果第一句太短（<8字），尝试补充第二句
        if len(summary) < 8 and len(sentences) > 1:
            combined = first + '；' + sentences[1]
            if len(combined) > 28:
                summary = combined[:28] + '…'
            else:
                summary = combined

    return summary


# ===================== 思维导图数据 =====================

@app.route('/api/mindmap/<int:topic_id>', methods=['GET'])
def get_mindmap(topic_id):
    """获取某主题的思维导图数据（树形结构 + Markdown 格式）"""
    conn = get_db()
    topic = conn.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
    if not topic:
        conn.close()
        return jsonify({'error': '主题不存在'}), 404

    notes = conn.execute(
        "SELECT * FROM notes WHERE topic_id=? ORDER BY created_at ASC",
        (topic_id,)
    ).fetchall()

    # 读取自定义节点树
    nodes = conn.execute(
        "SELECT * FROM mindmap_nodes WHERE topic_id=? ORDER BY order_idx ASC",
        (topic_id,)
    ).fetchall()

    # 如果思维导图没有节点但该主题有笔记，自动从笔记生成默认节点
    if not nodes and notes:
        for i, note in enumerate(notes):
            note_label = note['summary'] or note['content'][:30]
            c = conn.cursor()
            c.execute(
                "INSERT INTO mindmap_nodes (topic_id, parent_id, label, order_idx) VALUES (?, NULL, ?, ?)",
                (topic_id, note_label, i)
            )
        conn.commit()
        # 重新读取节点
        nodes = conn.execute(
            "SELECT * FROM mindmap_nodes WHERE topic_id=? ORDER BY order_idx ASC",
            (topic_id,)
        ).fetchall()

    conn.close()

    # 构建树形结构
    node_dict = {}
    tree = []
    for node in nodes:
        nd = dict(node)
        nd['children'] = []
        node_dict[nd['id']] = nd
    for nd in node_dict.values():
        if nd['parent_id'] and nd['parent_id'] in node_dict:
            node_dict[nd['parent_id']]['children'].append(nd)
        else:
            tree.append(nd)

    # 生成 Markdown
    lines = [f"# {topic['name']}"]
    for note in notes:
        content = note['content']
        summary = note['summary'] or content[:20]
        source_icon = {'voice': '🎤', 'ocr': '📷', 'text': '📝'}.get(note['source'], '📝')
        lines.append(f"## {source_icon} {summary}")
        paragraphs = [p.strip() for p in content.split('\n') if p.strip()]
        for p in paragraphs[:3]:
            if len(p) > 40:
                p = p[:40] + '…'
            lines.append(f"- {p}")

    return jsonify({
        'topic': dict(topic),
        'markdown': '\n'.join(lines),
        'nodes': tree,
        'note_count': len(notes)
    })


# ===================== 思维导图自动排版 =====================

@app.route('/api/mindmap/<int:topic_id>/auto-parse', methods=['POST'])
def auto_parse_mindmap(topic_id):
    """
    将文本内容自动解析为思维导图节点树
    支持：
    1. Markdown 风格层级（# ## ### -）
    2. 缩进层级（2空格/4空格/Tab）
    3. 编号列表（1. 1.1 1.1.1）
    4. 符号列表（- * +）
    5. 自然语言分句（无明确层级时按句子拆分）
    """
    data = request.json
    if not data:
        return jsonify({'error': '缺少请求数据'}), 400

    text = data.get('text', '').strip()
    if not text:
        return jsonify({'error': '文本内容不能为空'}), 400

    # 判断是否覆盖已有节点
    overwrite = data.get('overwrite', False)

    # 解析文本为节点树
    nodes = parse_text_to_nodes(text)

    if not nodes:
        return jsonify({'error': '未能从文本中解析出有效的思维导图结构'}), 400

    conn = get_db()
    try:
        # 如果覆盖，先清除该主题下所有旧节点
        if overwrite:
            conn.execute("DELETE FROM mindmap_nodes WHERE topic_id=?", (topic_id,))

        # 获取 topic 名称作为根节点引用
        topic = conn.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
        if not topic:
            conn.close()
            return jsonify({'error': '主题不存在'}), 404

        # 递归创建节点
        created_nodes = []
        for node in nodes:
            created = _create_node_tree(conn, topic_id, node, parent_id=None, order_idx=len(created_nodes))
            created_nodes.extend(created)

        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'nodes_created': len(created_nodes),
            'message': f'成功创建 {len(created_nodes)} 个节点',
            'nodes': created_nodes
        })

    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': f'创建节点失败: {str(e)}'}), 500


def _create_node_tree(conn, topic_id, node, parent_id, order_idx):
    """递归创建节点树"""
    c = conn.cursor()
    c.execute(
        "INSERT INTO mindmap_nodes (topic_id, parent_id, label, order_idx) VALUES (?, ?, ?, ?)",
        (topic_id, parent_id, node['label'], order_idx)
    )
    node_id = c.lastrowid
    created = [dict(conn.execute("SELECT * FROM mindmap_nodes WHERE id=?", (node_id,)).fetchone())]

    if 'children' in node and node['children']:
        for i, child in enumerate(node['children']):
            created.extend(_create_node_tree(conn, topic_id, child, node_id, i))

    return created


def parse_text_to_nodes(text):
    """
    将文本解析为思维导图节点树
    返回: [{'label': '...', 'children': [...]}, ...]
    """
    lines = [l.rstrip() for l in text.split('\n')]

    # 过滤全空行
    non_empty = [l for l in lines if l.strip()]

    if not non_empty:
        return []

    # 策略1: 检测 Markdown 标题层级 (# ## ###)
    has_md_headers = any(re.match(r'^#{1,6}\s', l) for l in non_empty)
    if has_md_headers:
        return _parse_markdown_style(non_empty)

    # 策略2: 检测编号层级 (1. / 1.1 / 1.1.1 / (一) / 一、)
    has_numbered = any(re.match(r'^[\d]+[\.\、\)]', l) or re.match(r'^[（(][一二三四五六七八九十]+[）)]', l) or re.match(r'^[一二三四五六七八九十]+[、．]', l) for l in non_empty)
    if has_numbered:
        return _parse_numbered_list(non_empty)

    # 策略3: 检测缩进层级（前导空格/Tab）
    has_indent = any(l.startswith(' ') or l.startswith('\t') for l in non_empty)
    if has_indent:
        return _parse_indented(non_empty)

    # 策略4: 检测符号列表（- * +）
    has_bullets = any(re.match(r'^[\-\*\+]\s', l) for l in non_empty)
    if has_bullets:
        return _parse_bullet_list(non_empty)

    # 策略5: 自然语言分句 —— 首句为根，其余按句号分拆
    return _parse_natural_language(non_empty)


def _parse_markdown_style(lines):
    """解析 Markdown 标题风格"""
    nodes = []
    stack = []  # (level, node)
    current_level = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        m = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if not m:
            # 不是标题行，尝试作为列表项
            list_m = re.match(r'^[\-\*\+]\s+(.*)', stripped)
            if list_m:
                # 列表项放在最后一个标题下
                item = {'label': list_m.group(1).strip()[:200]}
                if stack:
                    stack[-1][1].setdefault('children', []).append(item)
                else:
                    nodes.append(item)
            continue

        level = len(m.group(1))
        label = m.group(2).strip()[:200]

        node = {'label': label}

        # 找到合适的父节点
        while stack and stack[-1][0] >= level:
            stack.pop()

        if stack:
            stack[-1][1].setdefault('children', []).append(node)
        else:
            nodes.append(node)

        stack.append((level, node))

    return nodes


def _parse_numbered_list(lines):
    """解析编号列表（1. 1.1 1.1.1 等）"""
    nodes = []
    stack = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # 匹配各种编号格式
        m = re.match(r'^([\d]+(?:\.[\d]+)*)[\.\、\)]\s*(.*)', stripped)
        if not m:
            # 尝试中文编号
            m = re.match(r'^([（(][一二三四五六七八九十]+[）)])\s*(.*)', stripped)
            if not m:
                m = re.match(r'^([一二三四五六七八九十]+)[、．]\s*(.*)', stripped)
                if not m:
                    continue

        num_str = m.group(1)
        label = m.group(2).strip()[:200]

        # 计算层级深度
        if re.match(r'^[\d]', num_str):
            depth = num_str.count('.') + 1
        else:
            # 中文编号视为一级
            depth = 1

        node = {'label': label}

        # 找到合适父节点
        while stack and stack[-1][0] >= depth:
            stack.pop()

        if stack:
            stack[-1][1].setdefault('children', []).append(node)
        else:
            nodes.append(node)

        stack.append((depth, node))

    return nodes


def _parse_indented(lines):
    """解析缩进层级"""
    nodes = []
    stack = []  # (indent_level, node)

    for line in lines:
        stripped = line.lstrip()
        if not stripped:
            continue

        # 清理前导符号
        stripped = re.sub(r'^[\-\*\+]\s+', '', stripped)
        stripped = re.sub(r'^[\d]+[\.\、\)]\s*', '', stripped)
        label = stripped[:200]

        # 计算缩进级别
        indent = len(line) - len(line.lstrip())
        # 标准化缩进（2空格=1级）
        level = max(0, indent // 2)

        node = {'label': label}

        while stack and stack[-1][0] >= level:
            stack.pop()

        if stack:
            stack[-1][1].setdefault('children', []).append(node)
        else:
            nodes.append(node)

        stack.append((level, node))

    return nodes


def _parse_bullet_list(lines):
    """解析符号列表（- * +）"""
    nodes = []
    stack = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        m = re.match(r'^([\-\*\+])\s+(.*)', stripped)
        if not m:
            continue

        label = m.group(2).strip()[:200]
        # 计算缩进深度
        indent = len(line) - len(line.lstrip())
        level = max(0, indent // 2) + 1

        node = {'label': label}

        while stack and stack[-1][0] >= level:
            stack.pop()

        if stack:
            stack[-1][1].setdefault('children', []).append(node)
        else:
            nodes.append(node)

        stack.append((level, node))

    return nodes


def _parse_natural_language(lines):
    """
    自然语言分句：
    - 如果只有一行，按逗号、分号拆分子节点
    - 如果多行，每行一个子节点
    - 按句号、感叹号、问号分句
    """
    # 合并所有行
    full_text = ' '.join(lines)

    # 按句末标点分句
    sentences = re.split(r'[。！？!?\n]', full_text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if len(sentences) <= 1:
        # 只有一句，尝试按逗号/分号拆分
        parts = re.split(r'[；;，,]', full_text)
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) <= 1:
            # 实在太短，作为单个节点
            return [{'label': full_text[:200]}]
        nodes = []
        for p in parts:
            nodes.append({'label': p[:200]})
        return nodes

    # 多句：第一句作为主节点，其余为子节点
    nodes = []
    main_label = sentences[0][:200]
    main_node = {'label': main_label}
    if len(sentences) > 1:
        main_node['children'] = []
        for s in sentences[1:]:
            main_node['children'].append({'label': s[:200]})
    nodes.append(main_node)
    return nodes


# ===================== 思维导图节点 CRUD =====================

@app.route('/api/mindmap/<int:topic_id>/nodes', methods=['POST'])
def create_mindmap_node(topic_id):
    """创建思维导图节点"""
    data = request.json
    if not data or not data.get('label', '').strip():
        return jsonify({'error': '节点文字不能为空'}), 400

    conn = get_db()
    # 获取当前最大 order_idx
    max_order = conn.execute(
        "SELECT COALESCE(MAX(order_idx), -1) FROM mindmap_nodes WHERE topic_id=?",
        (topic_id,)
    ).fetchone()[0]

    parent_id = data.get('parent_id')
    c = conn.cursor()
    c.execute(
        "INSERT INTO mindmap_nodes (topic_id, parent_id, label, order_idx) VALUES (?, ?, ?, ?)",
        (topic_id, parent_id, data['label'].strip(), max_order + 1)
    )
    node_id = c.lastrowid
    conn.commit()
    node = conn.execute("SELECT * FROM mindmap_nodes WHERE id=?", (node_id,)).fetchone()
    conn.close()
    return jsonify(dict(node)), 201


@app.route('/api/mindmap/nodes/<int:node_id>', methods=['PUT'])
def update_mindmap_node(node_id):
    """更新思维导图节点（文字、排序位置）"""
    data = request.json
    conn = get_db()
    node = conn.execute("SELECT * FROM mindmap_nodes WHERE id=?", (node_id,)).fetchone()
    if not node:
        conn.close()
        return jsonify({'error': '节点不存在'}), 404

    label = data.get('label', node['label']).strip()
    new_parent_id = data.get('parent_id', node['parent_id'])
    new_order = data.get('order_idx', node['order_idx'])

    conn.execute(
        "UPDATE mindmap_nodes SET label=?, parent_id=?, order_idx=? WHERE id=?",
        (label, new_parent_id, new_order, node_id)
    )

    # 如果更新了排序，重新整理兄弟节点顺序
    if 'order_idx' in data:
        siblings = conn.execute(
            "SELECT id FROM mindmap_nodes WHERE topic_id=? AND parent_id IS ? ORDER BY order_idx ASC",
            (node['topic_id'], new_parent_id)
        ).fetchall()
        for i, sib in enumerate(siblings):
            conn.execute(
                "UPDATE mindmap_nodes SET order_idx=? WHERE id=?",
                (i, sib['id'])
            )

    conn.commit()
    updated = conn.execute("SELECT * FROM mindmap_nodes WHERE id=?", (node_id,)).fetchone()
    conn.close()
    return jsonify(dict(updated))


@app.route('/api/mindmap/nodes/<int:node_id>', methods=['DELETE'])
def delete_mindmap_node(node_id):
    """删除思维导图节点（级联删除子节点）"""
    conn = get_db()
    node = conn.execute("SELECT * FROM mindmap_nodes WHERE id=?", (node_id,)).fetchone()
    if not node:
        conn.close()
        return jsonify({'error': '节点不存在'}), 404

    # 递归删除子节点
    def delete_children(parent_id):
        children = conn.execute("SELECT id FROM mindmap_nodes WHERE parent_id=?", (parent_id,)).fetchall()
        for child in children:
            delete_children(child['id'])
            conn.execute("DELETE FROM mindmap_nodes WHERE id=?", (child['id'],))

    delete_children(node_id)
    conn.execute("DELETE FROM mindmap_nodes WHERE id=?", (node_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/mindmap/nodes/reorder', methods=['POST'])
def reorder_mindmap_nodes():
    """批量更新节点排序"""
    data = request.json
    if not data or 'orders' not in data:
        return jsonify({'error': '缺少排序数据'}), 400

    conn = get_db()
    for item in data['orders']:
        conn.execute(
            "UPDATE mindmap_nodes SET order_idx=?, parent_id=? WHERE id=?",
            (item['order_idx'], item.get('parent_id'), item['id'])
        )
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ===================== 统计 API =====================

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db()
    total_notes = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    total_topics = conn.execute("SELECT COUNT(*) FROM topics").fetchone()[0]
    today = datetime.now().strftime('%Y-%m-%d')
    today_notes = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE date(created_at)=?", (today,)
    ).fetchone()[0]
    conn.close()
    return jsonify({
        'total_notes': total_notes,
        'total_topics': total_topics,
        'today_notes': today_notes
    })


if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    init_db()
    print("=" * 50)
    print("  随心记 App 启动成功！")
    print("  访问地址: http://127.0.0.1:5000")
    print("=" * 50)
    app.run(debug=True, host='127.0.0.1', port=5000)
