import type { OfflineReport } from '../game/types';

/** 回到游戏时显示闭关时长和收益。 */
export function showOfflineReport(report: OfflineReport): void {
  const hours = Math.floor(report.seconds / 3600);
  const minutes = Math.floor((report.seconds % 3600) / 60);
  const overlay = document.createElement('div');
  overlay.className = 'offline';
  const box = document.createElement('div');
  box.className = 'offline-box';

  const title = document.createElement('h2');
  title.textContent = '闭关结束';
  const duration = document.createElement('div');
  duration.textContent = `闭关 ${hours} 小时 ${minutes} 分钟`;
  const rewards = document.createElement('div');
  rewards.textContent = `获得经验 ${report.exp}，灵石 ${report.gold}`;
  const lines = [rewards];
  if (report.equipment.length > 0) {
    const equipment = document.createElement('div');
    equipment.textContent = `收入背包：${report.equipment.join('、')}`;
    lines.push(equipment);
  }
  if (report.soldCount > 0) {
    const sold = document.createElement('div');
    sold.textContent = `背包已满，${report.soldCount} 件法器换成了灵石`;
    lines.push(sold);
  }
  const close = document.createElement('button');
  close.className = 'detail-action';
  close.textContent = '出关';
  close.addEventListener('click', () => overlay.remove());

  box.append(title, duration, ...lines, close);
  overlay.append(box);
  document.body.append(overlay);
}
