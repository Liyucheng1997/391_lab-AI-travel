# 途迹 · AI 旅行计划

在地图上规划和记录旅行。告诉 AI 目的地、天数和喜好，Claude 会把每天的地点排进地图、连好路线，你可以继续拖拽调整、打卡，再一键分享给同行的人。

**在线体验：** https://liyucheng1997.github.io/391_lab-AI-travel/

纯前端应用，没有服务器：行程、对话和设置都只保存在你自己的浏览器里。

## 功能

- **地图行程规划**：按天安排地点，地图上实时显示编号标记和路线（驾车 / 步行 / 骑行 / 直线），列表里显示每段路程的距离和用时
- **AI 规划助手**：填入你的 Claude API Key 后，用一句话生成整趟行程，或让它增删地点、调整顺序、估算花费、回答旅行问题。AI 直接调用工具修改行程，改动实时出现在地图上，一次 AI 运行可以整体撤销
- **地点搜索与添加**：搜索地点（OpenStreetMap），或直接点地图添加
- **编辑**：拖拽排序、跨天移动、到达时间、停留时长、花费、备注、打卡
- **路线优化**：一键把某天的地点按最短路线重新排序
- **预算**：按地点花费汇总，对比总预算
- **分享**：整份行程压缩进链接，对方打开即可只读查看，并能保存到自己的浏览器
- **足迹**：首页汇总所有行程的地点和打卡数
- **导入 / 导出 JSON**、深色模式、手机布局

## AI 设置

打开右上角「设置」：

| 项 | 说明 |
| --- | --- |
| API Key | 在 [Claude 控制台](https://platform.claude.com/settings/keys) 创建 |
| 认证方式 | 官方 Key 用 `x-api-key`；部分代理服务要求 `Bearer Token` |
| Base URL | 留空即官方地址；自定义地址必须允许浏览器跨域（CORS） |
| 模型 | Claude Opus 5.5（默认）/ Sonnet 5.5 / Haiku 5.5 |
| 思考强度 | 快速 / 均衡 / 深入 |
| 联网搜索 | 可选，用于查询开放时间、门票等最新信息，按次额外计费 |

请求通过 `@anthropic-ai/sdk` 从浏览器直接发往 Anthropic，Key 只存在本地存储里。不要在公用电脑上保存 Key。

## 本地开发

```bash
npm install
npm run dev
```

```bash
npm run build
```

推送到 `main` 后，GitHub Actions 会自动构建并部署到 GitHub Pages。

## 技术栈

React 18 · TypeScript · Vite · MapLibre GL · CARTO 底图 · OpenStreetMap Nominatim（地点搜索）· FOSSGIS OSRM（路线）· Anthropic TypeScript SDK

## 版本

- **v1.0.0**：首个版本
