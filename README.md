# Simple Start

简洁、高效、极具设计感的个人浏览器新标签页。

[![Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-orange?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## ✨ 核心特性

- 🕒 **智能问候系统**: 集成 [提摩科技节假日 API](https://timor.tech/)，根据工作日/周末/节假日输出不同问候。
- 🌤 **实时天气与动态动画**: 自动定位 + 天气数据展示 + 全屏天气动画。
- 🔍 **聚合搜索**: 支持百度、Bing、Google 多引擎切换。
- 🎨 **极简设计**: Glassmorphism 风格，动态背景，深色模式。
- 📱 **PWA 支持**: 可安装、可离线访问（App Shell 缓存）。
- ⌨️ **快捷键支持**:
  - `/`: 快速聚焦搜索框
  - `Tab`: 在搜索框聚焦时循环切换搜索引擎

## 🚀 运行模式

### 模式 A：PWA（推荐部署方式）

适用于 Cloudflare Pages / 普通静态站点。

- 使用 `manifest.webmanifest`
- 注册 `sw.js`
- 天气数据通过同源代理接口 `/api/weather`

### 模式 B：Chrome New Tab 扩展

适用于浏览器扩展场景。

- 使用 `manifest.json`（`chrome_url_overrides`）
- 直接覆盖新标签页
- 仍可请求同源天气代理（需你在扩展承载域部署对应接口）

## ☁️ Cloudflare Pages 部署（含天气代理）

1. Fork 本仓库。
2. 在 Cloudflare Dashboard 连接仓库并创建 Pages 项目。
3. 构建配置保持：
   - Framework preset: `None`
   - Build command: 留空
   - Output directory: `/`
4. 在项目设置中添加环境变量：
   - `QWEATHER_API_KEY=<你的和风天气Key>`
5. 推送代码后自动部署。

本项目包含 Pages Functions：`functions/api/weather.js`，用于代理和风天气请求，前端不再存储 API Key。

## 🧪 本地运行

建议通过本地 HTTP 服务器启动（避免 file:// 下 SW 行为受限）：

```bash
npx serve .
```

然后访问输出的本地地址。

## 🛠️ 技术栈

- **HTML5 / CSS3**: CSS 变量 + 主题切换 + 响应式布局
- **Vanilla JavaScript**: 无框架、低依赖
- **Service Worker**: 同源资源缓存与离线回退
- **Cloudflare Pages Functions**: 天气代理与密钥保护

## 📁 目录结构

```text
.
├── css/                    # 样式文件
├── js/                     # 前端逻辑（data/main/weather/animation）
├── img/                    # 图标与资源
├── functions/api/weather.js# 天气代理（服务端）
├── index.html              # 入口文件
├── manifest.json           # Chrome 扩展清单
├── manifest.webmanifest    # PWA 清单
└── sw.js                   # Service Worker
```

## 📄 开源协议

基于 [MIT License](LICENSE) 开源。
