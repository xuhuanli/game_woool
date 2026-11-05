# 文档索引

| 文档 | 定位 | 什么时候读 | 状态 |
| --- | --- | --- | --- |
| [`design.md`](design.md) | 总纲：玩法循环、职业战斗、成长经济、世界与内容、界面、技术架构 | 了解整体设计、做取舍 | 活文档，末端「差距与待补充」随版本更新 |
| [`m3-plan.md`](m3-plan.md) | 1～40 级内容与剧情计划，含各章实现细节、时长与数值调整 | 做内容、调数值、查某章做了什么 | 第 1～9 批已完成，40 级以后见 chapters 方案 |
| [`chapters-7-9-plan.md`](chapters-7-9-plan.md) | 40～55 级三章方案：大晋、昆吾山 | 开工第 8～9 章时 | 第 7 章完成，第 8 章制作中，第 9 章未开始 |
| [`garden-plan.md`](garden-plan.md) | 掌天瓶药园与炼丹方案 | 做药园、炼丹时 | 药园已完成，炼丹未开始 |
| [`simulation.md`](simulation.md) | 数值模拟结果与各章时长对照 | 调经验、掉落、怪物强度时 | 首轮 1～13 级，后续数字见 m3 / chapters |
| [`m2-plan.md`](m2-plan.md) | M2 核心系统的 6 批交付记录 | 回溯早期决策时 | 归档，全部完成 |
| [`art/`](art/) | 美术对比图与地图截图 | 核对美术效果时 | 图片资源 |

## 维护约定

1. **内容量以 `public/data/` 为准**。每次盘点都要重新统计地图、怪物、任务、物品的真实数量，不要沿用上一版数字——`design.md` 曾长期停留在「6 章 18 张图」，就是这个原因。
2. **一份文档只有一个权威范围**：整体设计与盘点看 `design.md`；各章实现细节看 `m3-plan.md`；未来章节方案看 `chapters-7-9-plan.md`。
3. **完成一项就在原文档打勾并写日期**，不要为已完成的工作另开新文档，避免同一事实散落多处。
4. **归档类文档只读不改**（`m2-plan.md`），需要新结论就写进 `m3-plan.md`。

## 当前代码与数据的入口

| 想知道什么 | 看哪里 |
| --- | --- |
| 地图、怪物、任务、物品、技能、NPC、成就 | `public/data/*.json` |
| 地图地形与装饰 | `public/maps/*.tmj`（由 `tools/make-map.ts` 生成） |
| 战斗、背包、技能、任务、境界、药园逻辑 | `src/game/*.ts` |
| UI 面板 | `src/ui/*.ts` |
| 渲染、地表、阴影、音频 | `src/render/*.ts` |
| 存档结构与迁移 | `src/save/saveData.ts`（当前 `SAVE_VERSION = 6`） |
| 精灵表烘焙 | `tools/bake/`（`npx vite --config tools/bake/vite.config.ts`） |
| 数值模拟 | `npm run sim` |
| 外部素材拉取 | `node tools/fetch-assets.mjs`，来源见 `assets-src/FREE-ASSETS.md` |
