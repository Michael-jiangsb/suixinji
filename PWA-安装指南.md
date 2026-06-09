# 随心记 PWA 安装指南

## 什么是 PWA？

PWA（渐进式 Web 应用）让网页应用像原生 App 一样：
- ✅ **可安装到桌面/主屏幕** — 像普通 App 一样有独立图标
- ✅ **离线使用** — 没有网络也能打开，数据存在本地 IndexedDB
- ✅ **零成本分发** — 不需要应用商店，扫码或链接即可安装
- ✅ **自动更新** — 打开时自动获取最新版本
- ✅ **跨平台** — Android / iOS / Windows / Mac 全部支持

---

## 一、部署到服务器

### 方式 1：GitHub Pages（免费，推荐）

```bash
# 1. 在 GitHub 创建仓库（如 suixinji-pwa）
# 2. 上传随心记-h5 目录中的所有文件
# 3. 在仓库 Settings → Pages 中启用
#     Source: Deploy from a branch
#     Branch: main / (root)
# 4. 等待几分钟，访问 https://你的用户名.github.io/suixinji-pwa/
```

### 方式 2：Vercel（免费）

```bash
# 1. 访问 vercel.com，用 GitHub 登录
# 2. Import 你的仓库
# 3. 一键部署，获得 https://xxx.vercel.app 域名
```

### 方式 3：Netlify（免费）

```bash
# 1. 访问 netlify.com
# 2. 拖拽 随心记-h5 文件夹到页面上
# 3. 自动部署，获得 https://xxx.netlify.app 域名
```

### 方式 4：自有服务器

```bash
# 使用任意静态文件服务器
python3 -m http.server 8080     # Python
npx serve .                      # Node.js
# 或 Nginx / Apache 等
```

### ⚠️ PWA 要求
- **必须使用 HTTPS**（GitHub Pages / Vercel / Netlify 自带 HTTPS）
- **本地测试**可以用 `http://localhost`（浏览器对 localhost 放宽限制）

---

## 二、安装到手机桌面

### Android 手机（Chrome / Edge / 三星浏览器）

1. 用浏览器打开你的 PWA 地址（如 `https://xxx.github.io/suixinji-pwa/`）
2. 浏览器会自动弹出 **"添加到主屏幕"** 提示
3. 如果没有弹出：
   - Chrome：点击右上角 `⋮` → **"添加到主屏幕"**
   - Edge：点击底部 `…` → **"添加到手机"**
   - 三星浏览器：点击底部 `≡` → **"添加页面到"** → **"主屏幕"**
4. 确认安装，桌面出现"随心记"图标
5. 点击图标打开，**以独立 App 形式运行**（无浏览器地址栏）

### iPhone / iPad（Safari）

1. 用 **Safari** 打开 PWA 地址（⚠️ 仅 Safari 支持，Chrome/iOS 不支持）
2. 点击底部中间的 **分享按钮** （↑ 图标）
3. 向下滚动，找到 **"添加到主屏幕"**
4. 点击右上角 **"添加"**
5. 桌面出现"随心记"图标
6. 点击图标打开，以独立 App 形式运行

---

## 三、本地测试 PWA

### 启动本地服务器

```bash
cd 随心记-h5
python3 -m http.server 8765
```

然后用 Chrome 打开 `http://localhost:8765`

### 验证 PWA 功能

1. 打开 Chrome DevTools（F12）
2. 切换到 **Application** 标签
3. 左侧 **Service Workers** — 确认 SW 状态为 "activated"
4. 左侧 **Manifest** — 确认图标和应用名正确
5. 勾选 **Offline** 复选框，刷新页面 — 应正常显示

---

## 四、离线功能说明

| 功能 | 离线可用？ | 说明 |
|------|:--:|------|
| 文字输入 | ✅ | 完全离线 |
| 语音识别 | ❌ | Web Speech API 需要联网 |
| 图片 OCR | ✅ | Tesseract.js 纯离线，首次需下载 20MB 语言包 |
| 图片上传 | ✅ | 图片存本地 IndexedDB |
| 思维导图 | ✅ | 完全离线 |
| 图库浏览 | ✅ | 完全离线 |
| 数据存储 | ✅ | IndexedDB，所有数据在本地 |

---

## 五、更新策略

- **自动更新**：每次打开 App 时，SW 会在后台检查更新
- **手动更新**：如果发现功能异常，在浏览器中打开 PWA 地址，会自动触发 SW 更新
- **强制更新**：清除浏览器缓存后重新访问

---

## 六、技术架构

```
随心记-h5/
├── index.html          # 主页面（含 PWA meta 标签）
├── manifest.json       # PWA 配置（图标/名称/主题色）
├── sw.js               # Service Worker（离线缓存）
├── icons/              # PWA 图标（72~512px）
│   ├── icon-72.png
│   ├── icon-192.png
│   └── icon-512.png
├── css/style.css       # 样式
├── js/
│   ├── db.js           # IndexedDB 数据层
│   └── app.js          # 应用逻辑
└── PWA-安装指南.md      # 本文件
```

---

## 七、分享给他人

部署到服务器后，只需分享链接即可：

- **微信分享**：直接发送链接，对方用浏览器打开后可安装
- **二维码**：用任意二维码生成器生成链接的二维码
- **NFC 标签**：写入链接，手机触碰即可打开

无需应用商店审核，无需下载安装包，无需注册账号。
