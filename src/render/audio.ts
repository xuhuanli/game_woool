const MUTE_KEY = 'xiuxian-muted';
const MASTER_VOLUME = 0.5;
const MUSIC_VOLUME = 0.1;
/** 五声音阶，听起来有古风 */
const PENTATONIC = [220, 247, 277.2, 329.6, 370, 440, 493.9, 554.4];
const MUSIC_STEP_SECONDS = 1.1;

type Wave = OscillatorType;

interface Note {
  frequency: number;
  to?: number;
  seconds: number;
  wave: Wave;
  volume: number;
  delay?: number;
}

const SOUNDS: Record<string, Note[]> = {
  hit: [{ frequency: 170, to: 70, seconds: 0.09, wave: 'square', volume: 0.25 }],
  crit: [
    { frequency: 240, to: 60, seconds: 0.14, wave: 'sawtooth', volume: 0.35 },
    { frequency: 880, to: 440, seconds: 0.1, wave: 'triangle', volume: 0.2 },
  ],
  hurt: [{ frequency: 130, to: 60, seconds: 0.14, wave: 'sawtooth', volume: 0.22 }],
  cast: [{ frequency: 330, to: 880, seconds: 0.2, wave: 'triangle', volume: 0.2 }],
  gold: [
    { frequency: 1320, seconds: 0.05, wave: 'triangle', volume: 0.12 },
    { frequency: 1760, seconds: 0.07, wave: 'triangle', volume: 0.12, delay: 0.05 },
  ],
  pickup: [{ frequency: 660, to: 990, seconds: 0.1, wave: 'triangle', volume: 0.18 }],
  rare: [
    { frequency: 523, seconds: 0.16, wave: 'triangle', volume: 0.3 },
    { frequency: 659, seconds: 0.16, wave: 'triangle', volume: 0.3, delay: 0.12 },
    { frequency: 880, seconds: 0.3, wave: 'triangle', volume: 0.32, delay: 0.24 },
  ],
  levelUp: [
    { frequency: 392, seconds: 0.14, wave: 'triangle', volume: 0.28 },
    { frequency: 523, seconds: 0.14, wave: 'triangle', volume: 0.28, delay: 0.12 },
    { frequency: 784, seconds: 0.32, wave: 'triangle', volume: 0.3, delay: 0.24 },
  ],
  warning: [{ frequency: 440, to: 330, seconds: 0.22, wave: 'square', volume: 0.14 }],
  death: [{ frequency: 300, to: 50, seconds: 0.6, wave: 'sawtooth', volume: 0.28 }],
  portal: [{ frequency: 220, to: 880, seconds: 0.35, wave: 'sine', volume: 0.25 }],
};

export type SoundName = keyof typeof SOUNDS;

/** 用 Web Audio 实时合成音效和背景音乐，不需要音频文件，正式素材可以后续替换。 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = readMuted();
  private musicIndex = 0;

  /** 浏览器要求用户操作后才能发声，在第一次按键或点击时调用。 */
  unlock(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.context.destination);
    window.setInterval(() => this.playMusicNote(), MUSIC_STEP_SECONDS * 1000);
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
    for (const note of SOUNDS[name] ?? []) this.playNote(note);
  }

  private playNote({ frequency, to, seconds, wave, volume, delay = 0 }: Note): void {
    const { context, master } = this;
    if (!context || !master) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, start + seconds);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + seconds);
  }

  /** 背景音乐：按五声音阶慢慢拨弦，用固定走向避免随机感。 */
  private playMusicNote(): void {
    const steps = [0, 2, 3, 5, 3, 2, 4, 3, 1, 2, 0, -1];
    const step = steps[this.musicIndex % steps.length] ?? 0;
    this.musicIndex += 1;
    if (step < 0) return;
    const frequency = PENTATONIC[step] ?? 220;
    this.playNote({ frequency, seconds: 1.4, wave: 'sine', volume: MUSIC_VOLUME });
    this.playNote({ frequency: frequency * 2, seconds: 0.5, wave: 'triangle', volume: MUSIC_VOLUME / 3 });
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
