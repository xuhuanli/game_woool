import type {
  Cell,
  ClassDef,
  CombatStats,
  DamageStat,
  ItemDef,
  MonsterDef,
  NpcDef,
  SkillDef,
} from './config';
import type { EquipSlot, Equipment } from './equipment';
import type { QuestState } from './quests';

export interface Vec {
  x: number;
  y: number;
}

export interface StatusEffect {
  kind: 'dot' | 'shield' | 'defense';
  left: number;
  /** dot 为每跳伤害，shield 为减伤比例，defense 为增加的防御 */
  amount: number;
  interval: number;
  nextTick: number;
  source: Unit;
}

interface PendingAction {
  target: Unit | null;
  skill: SkillDef | null;
}

export interface Unit {
  id: number;
  name: string;
  /** 逻辑所在格，开始走一步时就占住目标格 */
  cell: Cell;
  /** 连续坐标，用于平滑显示 */
  pos: Vec;
  facing: Vec;
  hp: number;
  mp: number;
  stats: CombatStats;
  moveSpeed: number;
  attackInterval: number;
  attackWindup: number;
  attackRange: number;
  attackStat: DamageStat;
  path: Cell[];
  attackCooldown: number;
  windupLeft: number;
  pending: PendingAction | null;
  repathLeft: number;
  effects: StatusEffect[];
}

export interface Monster extends Unit {
  kind: 'monster';
  def: MonsterDef;
  home: Cell;
  spawnKey: string;
  mode: 'idle' | 'chase' | 'return';
  target: Unit | null;
  wanderLeft: number;
  respawnLeft: number;
}

export interface Summon extends Unit {
  kind: 'summon';
  def: MonsterDef;
  target: Monster | null;
  lifeLeft: number;
}

export type PlayerOrder =
  | { type: 'move'; cell: Cell }
  | { type: 'attack'; target: Monster }
  | { type: 'cast'; skill: SkillDef; target: Monster }
  | { type: 'pickup'; itemId: number }
  | { type: 'talk'; npc: NpcDef };

export type HotbarEntry = { kind: 'skill'; id: string } | { kind: 'item'; id: string };

export interface Player extends Unit {
  kind: 'player';
  def: ClassDef;
  level: number;
  exp: number;
  gold: number;
  /** 可堆叠的丹药和材料 */
  bag: Record<string, number>;
  equipBag: Equipment[];
  equipment: Partial<Record<EquipSlot, Equipment>>;
  skills: string[];
  skillCooldowns: Record<string, number>;
  hotbar: (HotbarEntry | null)[];
  quests: QuestState;
  /** 已完成突破的境界 */
  realmPassed: string[];
  order: PlayerOrder | null;
  /** 出招途中按下的自身技能，出招结束后释放 */
  queuedSkill: SkillDef | null;
  respawnLeft: number;
  lastHurtAt: number;
}

export interface GroundItem {
  id: number;
  def: ItemDef;
  amount: number;
  equipment: Equipment | null;
  cell: Cell;
  expiresAt: number;
}

/** 死亡掉落的法器，切图后仍然保留，限时内可以回去捡。 */
export interface DeathDrop {
  mapId: string;
  item: GroundItem;
}

export type GameEvent =
  | { type: 'attackStart'; unit: Unit; target: Unit | null; color: string | null }
  | { type: 'skillCast'; unit: Unit; skill: SkillDef; cells: Cell[] }
  | { type: 'skillLearned'; skill: SkillDef }
  | { type: 'summoned'; unit: Summon }
  | { type: 'damage'; unit: Unit; amount: number; maxRoll: boolean; source: Unit }
  | { type: 'miss'; unit: Unit }
  | { type: 'death'; unit: Unit }
  | { type: 'respawn'; unit: Unit }
  | { type: 'itemDropped'; item: GroundItem }
  | { type: 'itemRemoved'; item: GroundItem }
  | { type: 'pickedUp'; item: GroundItem }
  | { type: 'equipped'; equipment: Equipment }
  | { type: 'refined'; equipment: Equipment; success: boolean }
  | { type: 'heal'; amount: number }
  | { type: 'mana'; amount: number }
  | { type: 'expGained'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'breakthrough'; realm: string; success: boolean }
  | { type: 'deathDrop'; name: string }
  | { type: 'mapChanged' }
  | { type: 'npcOpened'; npc: NpcDef }
  | { type: 'questAccepted'; name: string }
  | { type: 'questProgress'; name: string }
  | { type: 'questCompleted'; name: string }
  | { type: 'goldChanged'; amount: number }
  | { type: 'message'; text: string };
