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
  const close = document.createElement('button');
  close.className = 'detail-action';
  close.textContent = '出关';
  close.addEventListener('click', () => overlay.remove());

  box.append(title, duration, rewards, close);
  overlay.append(box);
  document.body.append(overlay);
}
