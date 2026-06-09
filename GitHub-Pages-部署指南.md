# 随心记 - GitHub Pages 部署指南

> **目标：** 将随心记 H5 PWA 应用部署到 GitHub Pages，实现永久免费、HTTPS、全球可访问。

---

## 前置条件

- [ ] 有 GitHub 账号（没有的话去 https://github.com 免费注册）
- [ ] 电脑已安装 Git（https://git-scm.com/download/win）

---

## 第一步：创建 GitHub 仓库

1. 登录 https://github.com
2. 点击右上角 **「+」** → **「New repository」**
3. 填写仓库信息：
   - **Repository name:** `suixinji`（或其他你喜欢的名字）
   - **Description:** `随心记 - 灵感记录与思维导图 PWA 应用`
   - **类型:** 选 `Public`（免费用户必须公开才能用 Pages）
   - **不要勾选** "Add a README file"（后面会自己创建）
4. 点击 **「Create repository」**

---

## 第二步：推送代码到 GitHub

打开**命令提示符（CMD）或 Git Bash**，执行以下命令：

```bash
# 进入随心记-h5 项目目录
cd "C:\Users\姜少波\WorkBuddy\2026-06-03-16-22-40\随心记-h5"

# 添加远程仓库地址（把 YOUR_USERNAME 换成你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/suixinji.git

# 推送代码
git push -u origin master
```

如果提示输入用户名密码，按以下方式认证：
- **方式一（推荐）：** 使用 GitHub Personal Access Token（Settings → Developer settings → Tokens (classic) → 勾选 `repo` 权限）
- **方式二：** 安装 GitHub CLI (`winget install GitHub.cli`)，然后运行 `gh auth login`

推送成功后，刷新 GitHub 仓库页面，应该能看到所有文件。

---

## 第三步：启用 GitHub Pages

1. 进入仓库页面，点击顶部 **「Settings」** 选项卡
2. 左侧菜单找到 **「Pages」**（在 "Code and automation" 分类下）
3. 在 "Build and deployment" 区域配置：
   - **Source:** 选择 `Deploy from a branch`
   - **Branch:** 选择 `master`，文件夹选 `/ (root)`
   - 点击 **「Save」**
4. 等待 1-2 分钟，页面顶部会显示：
   > Your site is live at `https://YOUR_USERNAME.github.io/suixinji/`

---

## 第四步：验证部署

1. 访问 `https://YOUR_USERNAME.github.io/suixinji/`
2. 你应该看到**登录界面**：
   - 账号：`admin`
   - 密码：`159357`
3. 登录后进入主应用，测试笔记、OCR、思维导图等功能
4. 验证 PWA：
   - 浏览器地址栏左侧应出现**安装图标**（⊕ 或小电脑图标）
   - 断网后刷新页面，应用仍能正常加载（Service Worker 离线缓存）

---

## 第五步：手机安装到桌面

### iPhone / iPad（Safari）
1. 用 **Safari 浏览器**打开 `https://YOUR_USERNAME.github.io/suixinji/`
2. 点底部中间的 **分享按钮**（方框+箭头图标）
3. 向下滚动，找到 **「添加到主屏幕」**
4. 点右上角 **「添加」**
5. 回到桌面，看到「随心记」图标，点击即可全屏使用 ✨

### Android（Chrome / Edge）
1. 用 **Chrome 浏览器**打开 `https://YOUR_USERNAME.github.io/suixinji/`
2. 点右上角 **⋮ → 添加到主屏幕** 或 **安装应用**
3. 点 **「安装」** 确认
4. 桌面出现「随心记」图标，点击全屏运行

---

## 后续更新流程

当你修改了代码想更新线上版本时：

```bash
cd "C:\Users\姜少波\WorkBuddy\2026-06-03-16-22-40\随心记-h5"

# 添加所有改动
git add -A

# 提交
git commit -m "更新说明：修复了xxx问题 / 新增了xxx功能"

# 推送
git push origin master
```

推送后 GitHub Pages 会**自动重新部署**，等 1-2 分钟刷新页面即可看到更新。

---

## 常见问题

### Q: 访问显示 404？
A: 确认 Pages 设置中 Branch 选的是 `master` 且文件夹是 `/ (root)`。检查仓库名是否和 URL 一致。

### Q: HTTPS 证书错误？
A: GitHub Pages 自动提供 HTTPS。如果刚启用，等几分钟让证书生效。

### Q: PWA 安装按钮不出现？
A: 需要 HTTPS（GitHub Pages 默认提供）+ 有效的 `manifest.json` + 已注册 Service Worker。确保这三个条件都满足。

### Q: 数据会丢失吗？
A: 数据存在浏览器本地的 **IndexedDB** 中，与 GitHub Pages 部署无关。只要不清除浏览器数据，数据就不会丢失。注意：不同设备之间的数据是独立的，不会自动同步。

### Q: 费用？
A: **完全免费**。GitHub Pages 对公开仓库免费，不限流量、不限请求次数。

---

## 技术信息

| 项目 | 详情 |
|------|------|
| 部署地址 | `https://YOUR_USERNAME.github.io/suixinji/` |
| 存储方式 | IndexedDB（浏览器本地） |
| 离线能力 | Service Worker Cache First 策略 |
| PWA 配置 | manifest.json + sw.js + 多尺寸图标 |
| 登录账号 | admin / 159357（7天免登录） |
| 兼容平台 | iOS Safari / Android Chrome / PC Chrome / Edge |
