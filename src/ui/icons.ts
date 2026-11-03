/** 技能和物品图标的地址，图标由 tools/make-icons.ts 生成。 */
export function iconUrl(id: string): string {
  return `${import.meta.env.BASE_URL}assets/icons/${id}.svg`;
}

export function iconImage(id: string, className = 'item-icon'): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = iconUrl(id);
  image.alt = '';
  image.draggable = false;
  return image;
}
