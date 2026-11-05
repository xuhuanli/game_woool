# 文档索引

> 本轮校准：2026-11-05 16:20。所有数量按 `public/data/` 与 `src/` 重新统计，不再沿用旧数字。

| 文档 | 定位 | 什么时候读 | 状态 |
| --- | --- | --- | --- |
| [`design.md`](design.md) | 总纲：玩法循环、职业战斗、成长经济、世界与内容、界面、技术架构 | 了解整体设计、做取舍 | 活文档，末端「差距与待补充」随版本更新 |
| [`m3-plan.md`](m3-plan.md) | 1～55 级内容与剧情计划，含各章实现细节、时长与数值调整 | 做内容、调数值、查某章做了什么 | 第 0～12 批全部完成；55 级以后见 `chapters-10-12-plan.md` |
| [`chapters-7-9-plan.md`](chapters-7-9-plan.md) | 40～55 级三章方案：天澜草原、大晋、昆吾山 | 查第 7～9 章为什么这么做 | 第 7～9 章全部完成 |
| [`chapters-10-12-plan.md`](chapters-10-12-plan.md) | 55～70 级三章方案：北夜小极宫、乱星海、偷渡灵界 | 开工第 10 章时 | 系统扩展（第 0 批）已完成；雪原地表、两档法器未做，章节内容未开始 |
| [`garden-plan.md`](garden-plan.md) | 掌天瓶药园与炼丹方案 | 做药园、炼丹时 | 第 1～2 批完成（9 种灵药、14 张丹方）；第 3 批未做 |
| [`simulation.md`](simulation.md) | 数值模拟结果与各章时长对照 | 调经验、掉落、怪物强度时 | 首轮 1～13 级；1～55 级数字见 m3 / chapters；55～70 级暂无可比数据 |
| [`m2-plan.md`](m2-plan.md) | M2 核心系统的 6 批交付记录 | 回溯早期决策时 | 归档，全部完成 |
| [`art/`](art/) | 美术对比图与地图截图 | 核对美术效果时 | 图片资源 |

## 维护约定

1. **内容量以 `public/data/` 为准**。每次盘点都要重新统计地图、怪物、任务、物品的真实数量，不要沿用上一版数字——`design.md` 曾长期停留在「6 章 18 张图」，2026-11-05 上午又停在「27 张图、第 9 章未开始」。
2. **一份文档只有一个权威范围**：整体设计与盘点看 `design.md`；各章实现细节看 `m3-plan.md`；未来章节方案看 `chapters-10-12-plan.md`。
3. **完成一项就在原文档打勾并写日期**，不要为已完成的工作另开新文档，避免同一事实散落多处。
4. **归档类文档只读不改**（`m2-plan.md`），需要新结论就写进 `m3-plan.md`。
5. **代码事实优先于文档**：文档写着「未开始 / 已有」时，先看 `src/` 和 `public/data/`。本轮就发现文档写着「炼丹未开始」，而 `garden.json` 与 `gardenPanel.ts` 已经做完两批。

## 当前代码与数据的入口

| 想知道什么 | 看哪里 |
| --- | --- |
| 地图、怪物、任务、物品、技能、NPC、成就、药园 | `public/data/*.json`（16 张表） |
| 地图地形与装饰 | `public/maps/*.tmj`（由 `tools/make-map.ts` 生成） |
| 战斗、背包、技能、任务、境界、药园与炼丹逻辑 | `src/game/*.ts`（药园与炼丹在 `garden.ts`） |
| UI 面板 | `src/ui/*.ts`：角色/背包 `panels.ts`、功法 `skillPanel.ts`、挂机 `autoPanel.ts`、图鉴 `codexPanel.ts`、药园 `gardenPanel.ts`、设置 `settingsPanel.ts`、存档 `savePanel.ts`、NPC `npcPanel.ts`；音量与画质偏好在 `src/game/settings.ts` |
| 按键与 HUD 结构 | `index.html` 的按钮与帮助行、`src/render/GameScene.ts` 的 `keydown-*` |
| 渲染、地表、阴影、音频 | `src/render/*.ts`（地表配色在 `groundPainter.ts`） |
| 存档结构与迁移 | `src/save/saveData.ts`（当前 `SAVE_VERSION = 6`）；槽位读写在 `src/save/saveStore.ts`、槽位列表与旧档迁移在 `src/save/saveSlots.ts` |
| 精灵表烘焙 | `tools/bake/`（`npx vite --config tools/bake/vite.config.ts`） |
| 图标生成 | `tools/make-icons.ts`（矢量）、`tools/make-item-icons.ts`（道具）、`tools/make-icon-sheet.ts`（评审页）、`tools/finish-skill-icons.mjs`（生图 → 去水印 → 256×256 jpg） |
| 数值模拟 | `npm run sim`，可传等级：`npm run sim -- 70` |
| 外部素材拉取 | `node tools/fetch-assets.mjs`，来源见 `assets-src/FREE-ASSETS.md` |
