import type {
  Cell,
  ClassDef,
  CombatStats,
  DamageStat,
  AbilityDef,
  AchievementDef,
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
  kind: 'dot' | 'shield' | 'defense' | 'empower';
  left: number;
  /** dot 为每跳伤害，shield 为减伤比例，defense 为增加的防御，empower 为增伤比例 */
  amount: number;
  interval: number;
  nextTick: number;
  source: Unit;
}

/** 持续伤害的地面，比如火墙、毒瘴。 */
export interface Field {
  id: number;
  caster: Unit;
  cells: Cell[];
  left: number;
  nextTick: number;
  interval: number;
  stat: DamageStat;
  /** 每跳伤害倍率，已经算上功法修炼 */
  multiplier: number;
  color: string;
  /** 怪物放的地面伤害玩家和召唤物，玩家放的伤害怪 */
  hostile: boolean;
}

interface PendingAction {
  target: Unit | null;
  skill: SkillDef | null;
  ability?: AbilityDef;
  cells?: Cell[];
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
  /** 被定身的剩余时间 */
  stunLeft: number;
}

export interface Monster extends Unit {
  kind: 'monster';
  def: MonsterDef;
  home: Cell;
  spawnKey: string;
  mode: 'idle' | 'chase' | 'return';
  target: Unit | null;
  abilityCooldowns: Record<string, number>;
  /** 已进入的 Boss 阶段数 */
  phase: number;
  /** 被召唤的小怪，死后不重生 */
  temporary?: boolean;
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

export interface RouteTarget {
  mapId: string;
  cell: Cell;
  /** 到达后与这个 NPC 对话 */
  npc?: NpcDef;
  /** 到达后开启挂机，优先打这种怪 */
  hunt?: string;
}

export interface AutoSettings {
  enabled: boolean;
  /** 自动拾取法器的最低品阶 */
  minGrade: string;
  potionBelow: number;
  /** 0 表示不自动回城 */
  recallBelow: number;
}

export interface GardenPlot {
  /** 种下的灵药 id，空地是 null */
  herb: string | null;
  /** 真实时间毫秒 */
  plantedAt: number;
  readyAt: number;
  /** 一键补种用：这块地上次种的灵药 */
  last: string | null;
}

export interface GardenState {
  plots: GardenPlot[];
  /** 掌天瓶绿液 */
  dew: number;
  /** 上一滴绿液凝成的真实时间毫秒 */
  dewAt: number;
  /** 累计收获，成就用 */
  harvested: Record<string, number>;
}

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
  /** 各境界的突破失败次数 */
  breakthroughFails: Record<string, number>;
  /** 功法等级，缺省为 1 */
  skillLevels: Record<string, number>;
  /** 各种怪的击杀次数，图鉴和 Boss 首杀都看它 */
  kills: Record<string, number>;
  /** 图鉴里见过的法器和见过的最高品阶下标 */
  codexItems: Record<string, number>;
  /** 已达成的成就 */
  achievements: string[];
  garden: GardenState;
  /** 仓库里的法器 */
  storage: Equipment[];
  reviveReadyAt: number;
  teleportReadyAt: number;
  /** 正在自动寻路的目的地 */
  route: RouteTarget | null;
  /** 突破失败后的虚弱状态，属性降低 */
  weakUntil: number;
  lastDeathAt: number;
  auto: AutoSettings;
  /** 闭关收益按最后到过的野外地图计算 */
  lastFieldMap: string | null;
  order: PlayerOrder | null;
  /** 本次移动是否跑步 */
  running: boolean;
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
  /** 玩家丢弃的东西，一键拾取、自动吸取和挂机都跳过 */
  discarded?: boolean;
}

export interface OfflineReport {
  seconds: number;
  exp: number;
  gold: number;
  /** 收进背包的法器名称 */
  equipment: string[];
  /** 背包放不下、换成灵石的法器件数 */
  soldCount: number;
  /** 药园里成熟的株数和绿液，没开掌天瓶时为 null */
  garden: { ready: number; dew: number } | null;
}

/** 死亡掉落的法器，切图后仍然保留，限时内可以回去捡。 */
export interface DeathDrop {
  mapId: string;
  item: GroundItem;
}

export type GameEvent =
  | { type: 'attackStart'; unit: Unit; target: Unit | null; color: string | null }
  | { type: 'skillCast'; unit: Unit; skill: SkillDef; cells: Cell[] }
  | { type: 'skillLearned'; skill: SkillDef; replaced?: SkillDef }
  | { type: 'achievement'; achievement: AchievementDef }
  | { type: 'gardenChanged' }
  | { type: 'gardenReady'; count: number }
  | { type: 'summoned'; unit: Summon }
  | { type: 'damage'; unit: Unit; amount: number; maxRoll: boolean; source: Unit }
  | { type: 'miss'; unit: Unit }
  | { type: 'death'; unit: Unit }
  | { type: 'respawn'; unit: Unit }
  | { type: 'itemDropped'; item: GroundItem }
  | { type: 'itemRemoved'; item: GroundItem }
  | { type: 'pickedUp'; item: GroundItem; magnet: boolean }
  | { type: 'equipped'; equipment: Equipment }
  | { type: 'refined'; equipment: Equipment; success: boolean }
  | { type: 'weakChanged' }
  | { type: 'heal'; amount: number }
  | { type: 'mana'; amount: number }
  | { type: 'expGained'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'breakthrough'; realm: string; success: boolean }
  | { type: 'deathDrop'; name: string }
  | { type: 'telegraph'; name: string; cells: Cell[]; seconds: number; color: string }
  | { type: 'npcsChanged' }
  | { type: 'monsterAdded'; unit: Monster }
  | { type: 'stunned'; unit: Unit }
  | { type: 'bossReady'; name: string; mapName: string }
  | { type: 'revived' }
  | { type: 'teleported' }
  | { type: 'skillUpgraded'; name: string; level: number }
  | { type: 'mapChanged' }
  | { type: 'npcOpened'; npc: NpcDef }
  | { type: 'questAccepted'; name: string }
  | { type: 'questProgress'; name: string }
  | { type: 'questCompleted'; name: string }
  | { type: 'goldChanged'; amount: number }
  | { type: 'message'; text: string };
