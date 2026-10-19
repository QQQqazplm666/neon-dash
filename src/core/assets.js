// ============================================================
// assets.js —— 资源加载器
// 当前版本的美术全部是 Canvas 代码绘制的，所以清单是空的。
// 但接口先留好：以后想加图片/音频，只要往 MANIFEST 里填表即可，
// 加载进度会自动传给 boot 场景的进度条。
// ============================================================

/**
 * 资源清单：名字 -> 相对路径
 * 例如：images: { ship: 'assets/ship.png' }
 * 注意：本项目要求完全离线可用，请把文件放进仓库里，不要用 CDN 外链。
 */
export const MANIFEST = {
  images: {},
  audios: {},
};

export class Assets {
  constructor(manifest = MANIFEST) {
    this.manifest = manifest;
    this.images = new Map();
    this.audios = new Map();
    this.loaded = false;
  }

  /** 图片总数 + 音频总数（用于算进度） */
  get total() {
    return Object.keys(this.manifest.images || {}).length + Object.keys(this.manifest.audios || {}).length;
  }

  /**
   * 加载全部资源。
   * @param {(progress:number, text:string)=>void} onProgress 进度回调（0..1）
   * @returns {Promise<Assets>}
   */
  async load(onProgress) {
    const total = this.total;
    let done = 0;
    const report = (text) => {
      if (!onProgress) return;
      onProgress(total === 0 ? 1 : done / total, text);
    };

    report('准备中…');
    if (total === 0) {
      // 没有资源也要报告一次 100%，不然进度条会一直停在 0
      this.loaded = true;
      report('完成');
      return this;
    }

    await this.loadImages(this.manifest.images || {}, () => { done++; report('加载图片…'); });
    await this.loadAudios(this.manifest.audios || {}, () => { done++; report('加载音频…'); });

    this.loaded = true;
    report('完成');
    return this;
  }

  /** 批量加载图片 */
  loadImages(map, onOne) {
    const jobs = Object.keys(map).map((name) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.images.set(name, img); if (onOne) onOne(name); resolve(img); };
      img.onerror = () => reject(new Error('图片加载失败: ' + map[name]));
      img.src = map[name];
    }));
    return Promise.all(jobs);
  }

  /** 批量加载音频（用 HTMLAudioElement，够用且零依赖） */
  loadAudios(map, onOne) {
    const jobs = Object.keys(map).map((name) => new Promise((resolve, reject) => {
      const a = new Audio();
      a.preload = 'auto';
      a.oncanplaythrough = () => { this.audios.set(name, a); if (onOne) onOne(name); resolve(a); };
      a.onerror = () => reject(new Error('音频加载失败: ' + map[name]));
      a.src = map[name];
    }));
    return Promise.all(jobs);
  }

  getImage(name) { return this.images.get(name) || null; }
  getAudio(name) { return this.audios.get(name) || null; }
}