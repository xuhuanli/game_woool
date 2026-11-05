import { HD_ICON_IDS, VECTOR_ICON_IDS } from './iconManifest';

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

/**
 * 掉在地上的物品图标。手绘位图是带深色底板的方卡，掉在地上会成一块方片，
 * 所以地上优先用透明底的矢量图，没有矢量图时才用位图。
 */
export function dropIconUrl(id: string): string {
  return VECTOR_ICON_IDS.has(id) ? `${import.meta.env.BASE_URL}assets/icons/v2/${id}.svg` : iconUrl(id);
}

/** 地上图标是不是位图（jpg）。位图要走 image 加载器，SVG 加载器解析不了。 */
export function isBitmapDropIcon(id: string): boolean {
  return !VECTOR_ICON_IDS.has(id) && HD_ICON_IDS.has(id);
}

export function iconImage(id: string, className = 'item-icon'): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = iconUrl(id);
  image.alt = '';
  image.draggable = false;
  return image;
}
