const MUTE_KEY = 'xiuxian-muted';
const MASTER_VOLUME = 0.5;
const MUSIC_VOLUME = 0.35;
const MUSIC_FADE_SECONDS = 1.5;

/** 音效和音乐都是 CC0，来源见 assets-src/audio/README.md。 */
const SOUNDS = {
  hit: { file: 'hit.ogg', volume: 0.5 },
  crit: { file: 'crit.wav', volume: 0.6 },
  hurt: { file: 'hurt.ogg', volume: 0.6 },
  cast: { file: 'cast.wav', volume: 0.4 },
  gold: { file: 'gold.ogg', volume: 0.35 },
  pickup: { file: 'pickup.ogg', volume: 0.5 },
  rare: { file: 'rare.ogg', volume: 0.7 },
  levelUp: { file: 'level-up.ogg', volume: 0.7 },
  warning: { file: 'warning.ogg', volume: 0.6 },
  death: { file: 'death.ogg', volume: 0.6 },
  portal: { file: 'portal.ogg', volume: 0.5 },
  questDone: { file: 'jingle-quest.ogg', volume: 0.5 },
  achievement: { file: 'jingle-achievement.ogg', volume: 0.5 },
} as const;

/** 背景音乐文件，键名就是地图配置里的 music */
const MUSIC: Record<string, string> = {
  town: 'music-town.ogg',
  caixia: 'music-caixia.ogg',
  taina: 'music-taina.ogg',
  forbidden: 'music-forbidden.ogg',
  yanling: 'music-yanling.ogg',
  sea: 'music-sea.ogg',
  xutian: 'music-xutian.ogg',
  zhuomo: 'music-zhuomo.ogg',
  tianlan: 'music-tianlan.ogg',
  jin: 'music-jin.ogg',
  /** Boss 盯上玩家时播放，不属于任何地图 */
  boss: 'music-boss.ogg',
};

export type SoundName = keyof typeof SOUNDS;

/** 播放音效和背景音乐，每章一首，主城共用一首，切图时淡入淡出。 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = readMuted();
  private readonly buffers = new Map<string, AudioBuffer>();
  private music: { name: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedMusic = 'town';

  /** 浏览器要求用户操作后才能发声，在第一次按键或点击时调用。 */
  unlock(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.context.destination);
    for (const { file } of Object.values(SOUNDS)) void this.load(file);
    // Boss 战随时可能开打，先把曲子载好，免得开打后才开始下载
    void this.load(MUSIC.boss!);
    this.playMusic(this.wantedMusic);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '');
    } catch {
      // 浏览器禁用存储时，静音设置只在本次生效
    }
    return this.muted;
  }

  play(name: SoundName): void {
    const { context, master } = this;
    const sound = SOUNDS[name];
    const buffer = this.buffers.get(sound.file);
    if (!context || !master || !buffer) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = sound.volume;
    source.connect(gain).connect(master);
    source.start();
  }

  /** 换背景音乐，同一首不重新开始；没配的名字用主城音乐。 */
  playMusic(name: string): void {
    const file = MUSIC[name] ?? MUSIC.town!;
    this.wantedMusic = name;
    const { context, master } = this;
    if (!context || !master || this.music?.name === name) return;
    const buffer = this.buffers.get(file);
    if (!buffer) {
      void this.load(file).then(() => this.wantedMusic === name && this.playMusic(name));
      return;
    }
    const now = context.currentTime;
    if (this.music) {
      const old = this.music;
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SECONDS);
      old.source.stop(now + MUSIC_FADE_SECONDS);
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MUSIC_VOLUME, now + MUSIC_FADE_SECONDS);
    source.connect(gain).connect(master);
    source.start();
    this.music = { name, source, gain };
  }

  private async load(file: string): Promise<void> {
    if (!this.context || this.buffers.has(file)) return;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${file}`);
      this.buffers.set(file, await this.context.decodeAudioData(await response.arrayBuffer()));
    } catch (error) {
      console.warn(`音频 ${file} 加载失败`, error);
    }
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
