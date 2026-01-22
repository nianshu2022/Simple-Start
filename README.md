# Simple Start

简洁、高效、极具设计感的个人浏览器新标签页。

[![Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-orange?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## ✨ 核心特性

- 🕒 **智能问候系统**: 集成 [提摩科技节假日 API](https://timor.tech/)。不仅仅是根据时间，更会根据当天是工作日、周末还是节假日，为你送上最贴心的问候。
- 🔍 **聚合搜索**: 支持百度、Bing、Google 多引擎一键切换，记住你的搜索习惯。
- 🎨 **极简设计**: 采用 Glassmorphism（玻璃拟态）风格，背景动态光晕，带来极致视觉享受。
- 📱 **PWA 支持**: 完美适配渐进式 Web 应用，可安装至桌面，离线也可用，秒开体验。
- ⌨️ **快捷键支持**: 
    - `/`: 快速聚焦搜索框
    - `Tab`: 在搜索框聚焦时循环切换搜索引擎
- 🌓 **深色模式**: 自动跟随系统主题，保护视力。

## 🚀 快速开始

### 部署到 Cloudflare Pages

1. **Fork 本仓库**: 点击右上角的 Fork 按钮。
2. **连接 Cloudflare**: 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 `Workers & Pages` -> `Create application` -> `Pages` -> `Connect to Git`。
3. **完成配置**: 选择 Fork 的仓库，框架预设选择 `None`，构建命令留空，发布目录填 `/`。
4. **即刻访问**: 每次推送代码，Cloudflare 都会自动完成部署。

### 本地运行

直接在浏览器中打开 `index.html` 即可使用。通过本地 HTTP 服务器（如 `npx serve`）运行以获得完整的 Service Worker 支持。

## 🛠️ 技术栈

- **HTML5 / CSS3**: 使用 CSS 变量实现主题切换，Flex/Grid 布局。
- **Vanilla JavaScript**: 严控依赖，追求极致的加载速度和运行效率。
- **Service Worker**: 实现 PWA 离线缓存逻辑。

## 📁 目录结构

```text
.
├── css/             # 样式文件
├── js/              # 核心逻辑 (data.js 存放书签数据)
├── img/             # 图标及资源文件
├── index.html       # 入口文件
├── manifest.json    # PWA 清单
└── sw.js            # Service Worker
```

## 📄 开源协议

基于 [MIT License](LICENSE) 开源。
