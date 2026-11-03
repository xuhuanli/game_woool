const MUTE_KEY = 'xiuxian-muted';
const MASTER_VOLUME = 0.5;
const MUSIC_VOLUME = 0.35;
const MUSIC_FADE_SECONDS = 1.5;

/**
 * 音效来自 Kenney 的 RPG Sounds 和 Interface Sounds，音乐来自 OpenGameArt，都是 CC0。
 * 原始素材和授权文件在 assets-src/audio/。
 */
const SOUNDS = {
  hit: { file: 'hit', volume: 0.5 },
  crit: { file: 'crit', volume: 0.7 },
  hurt: { file: 'hurt', volume: 0.6 },
  cast: { file: 'cast', volume: 0.4 },
  gold: { file: 'gold', volume: 0.35 },
  pickup: { file: 'pickup', volume: 0.5 },
  rare: { file: 'rare', volume: 0.7 },
  levelUp: { file: 'level-up', volume: 0.7 },
  warning: { file: 'warning', volume: 0.6 },
  death: { file: 'death', volume: 0.6 },
  portal: { file: 'portal', volume: 0.5 },
} as const;

export type SoundName = keyof typeof SOUNDS;
export type MusicName = 'town' | 'field';

/** 播放音效和背景音乐，主城和野外各一首，切图时淡入淡出。 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = readMuted();
  private readonly buffers = new Map<string, AudioBuffer>();
  private music: { name: MusicName; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedMusic: MusicName = 'town';

  /** 浏览器要求用户操作后才能发声，在第一次按键或点击时调用。 */
  unlock(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.context.destination);
    for (const { file } of Object.values(SOUNDS)) void this.load(file);
    void this.load(`music-${this.wantedMusic}`).then(() => this.playMusic(this.wantedMusic));
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

  /** 换背景音乐，同一首不重新开始。 */
  playMusic(name: MusicName): void {
    this.wantedMusic = name;
    const { context, master } = this;
    if (!context || !master || this.music?.name === name) return;
    const buffer = this.buffers.get(`music-${name}`);
    if (!buffer) {
      void this.load(`music-${name}`).then(() => this.wantedMusic === name && this.playMusic(name));
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
      const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${file}.ogg`);
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
