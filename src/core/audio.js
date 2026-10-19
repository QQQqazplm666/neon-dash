// ============================================================
// audio.js —— WebAudio 程序化音效 + 程序化背景音乐
// 完全不依赖任何音频文件：所有声音都是用振荡器 + 噪声实时合成的。
// 两条总线：sfxBus（音效）/ musicBus（音乐），各自有独立静音开关。
// 浏览器的 AudioContext 必须在「用户第一次交互」之后才能出声，
// 所以由 input.onFirstInput 调用 unlock()。
//
// 【v1.1 改动（音质）】
//   1) 所有发声都走 ADSR：增益从 0 起、结束时收到 0.0001 再停振荡器，
//      彻底消掉「爆音 / 咔哒声」（旧版 noise() 直接从 vol 起，必然爆）。
//   2) 音效分波形：跳跃三角波、二段跳正弦+方波、落地噪声+低频正弦、
//      金币方波、撞击锯齿+噪声、商城三角波连音、UI 方波小点。
//   3) 连吃金币音高递增（golden combo），撞击 / 重开时重置。
//   4) 背景音乐重做为可循环的和声进行（Am–F–C–G），
//      低音 + 琶音 + 铺底 pad + 轻打点四条声部，
//      并按玩法难度轻微提速 / 加密度（setMusicIntensity）。
//   5) 音乐进出场用淡入淡出，不再硬切。
// ============================================================

export class Audio {
  constructor(settings) {
    this.ctx = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
    this.settings = settings || { sfx: true, music: true };
    this.unlocked = false;
    this._musicTimer = null;
    this._step = 0;
    this._nextNoteTime = 0;
    this._tempo = 0.125;        // 每步 0.125 秒 = 120BPM 的十六分音符
    this._intensity = 0;        // 0..1，随难度上升
    this._combo = 0;            // 连吃金币数（只影响音高）
    this._musicVol = 0.16;      // musicBus 的目标音量（淡入淡出用）
  }

  get sfxOn() { return !!this.settings.sfx; }
  get musicOn() { return !!this.settings.music; }
  get combo() { return this._combo; }

  // ---------------- 初始化 ----------------
  /** 在第一次用户交互时调用：创建 AudioContext 并恢复播放 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                     // 浏览器不支持就静默降级
      try {
        this.ctx = new AC();
      } catch (e) {
        console.warn('[audio] 无法创建 AudioContext：', e);
        return;
      }
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.5;
      this.musicBus.gain.value = 0;         // 从 0 起，由 startMusic 淡入
      this.sfxBus.connect(this.ctx.destination);
      this.musicBus.connect(this.ctx.destination);
      this._buildNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.unlocked = true;
  }

  _buildNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  // ---------------- 基础发声单元 ----------------
  /**
   * 包络：从 0 起 → 按 attack 冲到 vol → 时长结束前收到静音。
   * 两头都是 0，所以不会有爆音。
   */
  _envelope(gainNode, t0, dur, vol, attack) {
    // 【重要】setValueAtTime / linearRampToValueAtTime 属于 AudioParam，
    // 不属于 GainNode 本体：必须写 gainNode.gain，写成 gainNode.setValueAtTime
    // 在真实浏览器里会每一声都抛 TypeError（全部音效哑掉）。
    const gain = gainNode && gainNode.gain;
    if (!gain || typeof gain.setValueAtTime !== 'function') return;
    const atk = Math.min(attack === undefined ? 0.012 : attack, dur * 0.5);
    gain.setValueAtTime(0, t0);
    gain.linearRampToValueAtTime(Math.max(0.0002, vol), t0 + atk);
    gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    gain.setValueAtTime(0, t0 + dur + 0.001);   // 收尾硬归零，确保无声
  }

  /**
   * 播放一个音（频率可以来回扫）
   * type 波形 / from→to 频率 / dur 时长 / vol 音量 / delay 延迟 / bus 总线
   */
  tone(opts = {}) {
    const busName = opts.bus === 'music' ? 'music' : 'sfx';
    if (!this.ctx) return;
    if (busName === 'music' ? !this.musicOn : !this.sfxOn) return;
    const bus = busName === 'music' ? this.musicBus : this.sfxBus;
    if (!bus) return;

    const type = opts.type || 'sine';
    const from = opts.from || 440;
    const to = opts.to === undefined ? from : opts.to;
    const dur = opts.dur || 0.15;
    const vol = opts.vol === undefined ? 0.3 : opts.vol;
    const delay = opts.delay || 0;

    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, from), t0);
    if (to !== from) {
      // 用指数扫频听起来更自然（频率不能为 0，所以取 max(1,...)）
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    }
    this._envelope(gain, t0, dur, vol, opts.attack);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  /** 播放一段噪声（落地、撞击、打点用） */
  noise(opts = {}) {
    const busName = opts.bus === 'music' ? 'music' : 'sfx';
    if (!this.ctx || !this.noiseBuffer) return;
    if (busName === 'music' ? !this.musicOn : !this.sfxOn) return;
    const bus = busName === 'music' ? this.musicBus : this.sfxBus;
    if (!bus) return;

    const dur = opts.dur || 0.12;
    const vol = opts.vol === undefined ? 0.25 : opts.vol;
    const delay = opts.delay || 0;

    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.highpass ? 'highpass' : 'lowpass';
    filter.frequency.setValueAtTime(opts.cutoff || 1200, t0);
    if (opts.cutoffTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.cutoffTo), t0 + dur);
    const gain = this.ctx.createGain();
    this._envelope(gain, t0, dur, vol, opts.attack === undefined ? 0.004 : opts.attack);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // ---------------- 具体音效 ----------------
  jump() {
    this.tone({ type: 'triangle', from: 340, to: 760, dur: 0.14, vol: 0.28, attack: 0.006 });
    this.tone({ type: 'square', from: 680, to: 1200, dur: 0.08, vol: 0.05, attack: 0.004 });
  }

  doubleJump() {
    this.tone({ type: 'sine', from: 520, to: 1180, dur: 0.16, vol: 0.26, attack: 0.005 });
    this.tone({ type: 'square', from: 1040, to: 1720, dur: 0.1, vol: 0.09, attack: 0.004, delay: 0.02 });
    this.noise({ dur: 0.12, vol: 0.07, cutoff: 5200, cutoffTo: 2000, highpass: true });
  }

  land() {
    this.noise({ dur: 0.12, vol: 0.22, cutoff: 900, cutoffTo: 180 });
    this.tone({ type: 'sine', from: 190, to: 80, dur: 0.12, vol: 0.18, attack: 0.004 });
  }

  /**
   * v1.3 弹簧跳板：压缩回弹的「啵——咻」。
   * 先用一小段高频噪声当弹簧被压下去的气声，再让音高一路往上冲，
   * 听感上「弹得比二段跳更高」，和 doubleJump 明显区分。
   */
  spring() {
    this.noise({ dur: 0.08, vol: 0.16, cutoff: 2600, cutoffTo: 6400, highpass: true });
    this.tone({ type: 'triangle', from: 240, to: 1520, dur: 0.26, vol: 0.3, attack: 0.005 });
    this.tone({ type: 'square', from: 480, to: 2400, dur: 0.18, vol: 0.08, attack: 0.004, delay: 0.02 });
  }

  /**
   * 吃金币：连吃时音高逐个升高（do re mi…），最多升一个八度多一点。
   * 撞击后调用 resetCombo() 归零。
   */
  coin() {
    const n = Math.min(this._combo, 12);
    this._combo++;
    const ratio = Math.pow(2, n / 12);
    const f1 = 880 * ratio;
    const f2 = 1320 * ratio;
    this.tone({ type: 'square', from: f1, to: f1, dur: 0.06, vol: 0.15, attack: 0.003 });
    this.tone({ type: 'square', from: f2, to: f2, dur: 0.1, vol: 0.15, attack: 0.003, delay: 0.055 });
    this.tone({ type: 'sine', from: f2 * 1.5, to: f2 * 1.5, dur: 0.08, vol: 0.05, attack: 0.003, delay: 0.055 });
  }

  /** 连吃计数归零（撞击 / 重开一局时调用） */
  resetCombo() { this._combo = 0; }

  hit() {
    this.tone({ type: 'sawtooth', from: 420, to: 55, dur: 0.42, vol: 0.32, attack: 0.003 });
    this.tone({ type: 'square', from: 160, to: 60, dur: 0.3, vol: 0.16, attack: 0.003 });
    this.noise({ dur: 0.38, vol: 0.32, cutoff: 2400, cutoffTo: 120 });
    this.resetCombo();
  }

  /** UI 点击：短促的方波小点 */
  click() {
    this.tone({ type: 'square', from: 660, to: 990, dur: 0.06, vol: 0.13, attack: 0.003 });
  }

  /** 商城购买成功：上行的三角波三连音 */
  buy() {
    const notes = [523.25, 659.25, 880];
    for (let i = 0; i < notes.length; i++) {
      this.tone({ type: 'triangle', from: notes[i], to: notes[i], dur: 0.16, vol: 0.2, delay: i * 0.07, attack: 0.005 });
    }
    this.tone({ type: 'sine', from: 1760, to: 1760, dur: 0.22, vol: 0.08, delay: 0.2, attack: 0.005 });
  }

  /** 装备皮肤：一声轻快的确认音 */
  equip() {
    this.tone({ type: 'triangle', from: 700, to: 1200, dur: 0.18, vol: 0.2, attack: 0.005 });
  }

  /** 金币不足 / 非法操作：低频双短音，明确「不行」但不刺耳 */
  deny() {
    this.tone({ type: 'square', from: 220, to: 160, dur: 0.1, vol: 0.16, attack: 0.004 });
    this.tone({ type: 'square', from: 165, to: 120, dur: 0.14, vol: 0.16, delay: 0.11, attack: 0.004 });
  }

  /** 新纪录的小连音 */
  fanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      this.tone({ type: 'triangle', from: notes[i], to: notes[i], dur: 0.2, vol: 0.2, delay: i * 0.1, attack: 0.005 });
    }
  }

  // ---------------- 背景音乐（程序化循环） ----------------
  //
  // 和声进行：Am → F → C → G（A 小调，四个和弦各占 16 步 = 2 秒，整圈 8 秒）
  // 每步 0.125 秒（十六分音符 @120BPM），难度高时轻微提速到 0.112 秒。
  // 声部：
  //   bass  每个和弦的根音（锯齿波，长音）
  //   arp   和弦分解（方波，隔步出现）
  //   pad   和弦三音铺底（三只失谐正弦，慢起慢落）
  //   tick  反拍噪声打点（难度越高越密）
  static MUSIC = {
    chords: [
      { root: 110.00, tones: [220.00, 261.63, 329.63] },   // Am
      { root: 87.31, tones: [220.00, 261.63, 349.23] },    // F
      { root: 130.81, tones: [261.63, 329.63, 392.00] },   // C
      { root: 98.00, tones: [246.94, 293.66, 392.00] },    // G
    ],
    stepsPerChord: 16,
  };

  startMusic() {
    if (!this.ctx || !this.musicOn || this._musicTimer) return;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.06;
    this._fadeMusicTo(this._musicVol, 0.8);      // 淡入
    // 每 40ms 检查一次，提前把未来 0.2 秒内的音符排好队
    this._musicTimer = setInterval(() => this._scheduleMusic(), 40);
  }

  stopMusic() {
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
  }

  /** 淡出并停掉音乐（回菜单时用） */
  fadeOutMusic(dur = 0.6) {
    if (this.ctx) this._fadeMusicTo(0, dur);
    this.stopMusic();
  }

  _fadeMusicTo(target, dur) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, target), t + Math.max(0.01, dur));
  }

  /**
   * 按难度调整音乐「强度」（0..1）：只做轻微提速与加密，不改变旋律。
   * play 场景每帧调用一次也不会出问题（只在变化超过阈值时才改）。
   */
  setMusicIntensity(k) {
    const v = k < 0 ? 0 : (k > 1 ? 1 : k);
    if (Math.abs(v - this._intensity) < 0.02) return;
    this._intensity = v;
    const target = 0.125 - 0.013 * v;             // 120BPM → 约 134BPM
    if (Math.abs(target - this._tempo) > 0.0005) this._tempo = target;
    if (this.ctx) this._fadeMusicTo(this._musicVol * (1 + 0.25 * v), 0.4);
  }

  _scheduleMusic() {
    if (!this.ctx || !this.musicOn) { this.stopMusic(); return; }
    const lookahead = 0.25;
    const total = Audio.MUSIC.stepsPerChord * Audio.MUSIC.chords.length;
    while (this._nextNoteTime < this.ctx.currentTime + lookahead) {
      this._playMusicStep(this._step, this._nextNoteTime);
      this._nextNoteTime += this._tempo;
      this._step = (this._step + 1) % total;
    }
  }

  _playMusicStep(step, time) {
    const M = Audio.MUSIC;
    const chordIndex = Math.floor(step / M.stepsPerChord) % M.chords.length;
    const local = step % M.stepsPerChord;
    const chord = M.chords[chordIndex];
    const delay = Math.max(0, time - this.ctx.currentTime);
    const inten = this._intensity;

    // 低音：和弦根音，占满整个和弦
    if (local % 8 === 0) {
      this.tone({ type: 'sawtooth', from: chord.root, to: chord.root, dur: 0.9, vol: 0.085, delay, bus: 'music', attack: 0.02 });
      this.tone({ type: 'sine', from: chord.root / 2, to: chord.root / 2, dur: 1.0, vol: 0.06, delay, bus: 'music', attack: 0.03 });
    }

    // 铺底 pad：和弦一进来就铺三个音，慢起慢落
    if (local === 0) {
      for (let i = 0; i < chord.tones.length; i++) {
        this.tone({
          type: 'sine', from: chord.tones[i], to: chord.tones[i],
          dur: 1.9, vol: 0.028, delay, bus: 'music', attack: 0.35,
        });
        // 轻微失谐的一层，让 pad 有厚度（不额外加音符，只是复制并偏差 1.5Hz）
        this.tone({
          type: 'triangle', from: chord.tones[i] + 1.5, to: chord.tones[i] + 1.5,
          dur: 1.9, vol: 0.016, delay, bus: 'music', attack: 0.4,
        });
      }
    }

    // 琶音：十六分音符分解和弦（难度越高出现越密）
    const arpPattern = [0, 1, 2, 1, 2, 0, 1, 2];
    const gate = local % 2 === 1 ? 1 : (inten > 0.45 ? 0.55 : 0);
    if (gate) {
      const tone = chord.tones[arpPattern[local % arpPattern.length]];
      this.tone({
        type: 'square', from: tone * 2, to: tone * 2,
        dur: 0.11, vol: 0.032 + 0.012 * inten, delay, bus: 'music', attack: 0.004,
      });
    }

    // 反拍打点：难度高时才出现，给速度感
    if (inten > 0.3 && local % 4 === 2) {
      this.noise({ dur: 0.05, vol: 0.02 + 0.02 * inten, cutoff: 7000, highpass: true, delay, bus: 'music' });
    }
  }

  /** 设置变化后同步音乐开关 */
  refreshMusic() {
    if (this.musicOn) this.startMusic();
    else this.fadeOutMusic(0.25);
  }
}

export default Audio;