const GAP = 14;

let box: HTMLElement | null = null;
let owner: HTMLElement | null = null;

function tooltipBox(): HTMLElement {
  if (!box) {
    box = document.createElement('div');
    box.className = 'tooltip';
    box.hidden = true;
    document.body.append(box);
  }
  return box;
}

/** 把浮窗放在鼠标旁边，超出窗口时翻到另一侧，始终留在屏幕内。 */
function place(x: number, y: number): void {
  const tip = tooltipBox();
  const { width, height } = tip.getBoundingClientRect();
  const left = x + GAP + width > innerWidth ? x - GAP - width : x + GAP;
  const top = y + GAP + height > innerHeight ? innerHeight - height - 4 : y + GAP;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

export function showTooltip(content: Node[], x: number, y: number, from: HTMLElement | null = null): void {
  const tip = tooltipBox();
  tip.replaceChildren(...content);
  tip.hidden = content.length === 0;
  owner = from;
  place(x, y);
}

export function hideTooltip(): void {
  tooltipBox().hidden = true;
  owner = null;
}

/** 鼠标移到元素上时显示浮窗，内容每次现算，元素被移除后自动收起。 */
export function attachTooltip(element: HTMLElement, render: () => Node[]): void {
  element.addEventListener('mouseenter', (event) => showTooltip(render(), event.clientX, event.clientY, element));
  element.addEventListener('mousemove', (event) => {
    if (owner === element) place(event.clientX, event.clientY);
  });
  element.addEventListener('mouseleave', () => {
    if (owner === element) hideTooltip();
  });
}

/** 浮窗主人被重建掉时收起，避免留下一张悬空的浮窗。 */
export function hideOrphanTooltip(): void {
  if (owner && !owner.isConnected) hideTooltip();
}

export function line(text: string, className = ''): HTMLElement {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}
