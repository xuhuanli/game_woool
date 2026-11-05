import { HD_ICON_IDS } from './iconManifest';

/**
 * 技能和物品图标的地址，按优先级取：
 * 1. hd/  手绘位图（256×256）
 * 2. v2/  新矢量方案（无底板 · 灵光主体），由 tools/make-item-icons.ts 生成
 * 测试会检查每个技能和物品至少有其中一套。
 */
export function iconUrl(id: string): string {
  const base = import.meta.env.BASE_URL;
  if (HD_ICON_IDS.has(id)) return `${base}assets/icons/hd/${id}.jpg`;
  return `${base}assets/icons/v2/${id}.svg`;
}

/** 这个图标是不是高清位图（jpg）。位图要走 image 加载器，SVG 加载器解析不了。 */
export function isHdIcon(id: string): boolean {
  return HD_ICON_IDS.has(id);
}

export function iconImage(id: string, className = 'item-icon'): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = iconUrl(id);
  image.alt = '';
  image.draggable = false;
  return image;
}
