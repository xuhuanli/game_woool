import type { GameConfig, ObjectiveType, QuestDef } from './config';

export interface QuestProgress {
  id: string;
  /** 与任务目标一一对应的进度，收集类目标按背包实时计算 */
  counts: number[];
}

export interface QuestState {
  active: QuestProgress[];
  completed: string[];
}

export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';

export function emptyQuestState(): QuestState {
  return { active: [], completed: [] };
}

export function objectiveCount(
  quest: QuestDef,
  index: number,
  progress: QuestProgress,
  bag: Record<string, number>,
): number {
  const objective = quest.objectives[index];
  if (!objective) return 0;
  const count = objective.type === 'collect' ? (bag[objective.target] ?? 0) : (progress.counts[index] ?? 0);
  return Math.min(count, objective.count);
}

export function questStatus(
  quest: QuestDef,
  state: QuestState,
  level: number,
  bag: Record<string, number>,
): QuestStatus {
  if (state.completed.includes(quest.id)) return 'done';
  const progress = state.active.find((candidate) => candidate.id === quest.id);
  if (progress) {
    const finished = quest.objectives.every(
      (objective, index) => objectiveCount(quest, index, progress, bag) >= objective.count,
    );
    return finished ? 'ready' : 'active';
  }
  const unlocked = !quest.prev || state.completed.includes(quest.prev);
  return unlocked && level >= quest.level ? 'available' : 'locked';
}

/** 记录一次目标进度，返回有进度变化的任务。 */
export function recordObjective(
  state: QuestState,
  config: GameConfig,
  type: ObjectiveType,
  target: string,
): QuestDef[] {
  const changed: QuestDef[] = [];
  for (const progress of state.active) {
    const quest = config.quests[progress.id];
    if (!quest) continue;
    quest.objectives.forEach((objective, index) => {
      const count = progress.counts[index] ?? 0;
      if (objective.type === type && objective.target === target && count < objective.count) {
        progress.counts[index] = count + 1;
        changed.push(quest);
      }
    });
  }
  return changed;
}

export function questsForNpc(config: GameConfig, npcId: string): QuestDef[] {
  return Object.values(config.quests).filter((quest) => quest.giver === npcId);
}
