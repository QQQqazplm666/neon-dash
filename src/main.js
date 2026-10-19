// ============================================================
// main.js —— 游戏入口
// 顺序：创建引擎 → 组装所有系统 → 注册场景 → 启动主循环。
// 想改玩法配置请去 config.js，想加场景就在下面 register 一行。
// ============================================================
import { DESIGN_WIDTH, DESIGN_HEIGHT, VERSION } from './config.js';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { SceneManager } from './core/scenes.js';
import { Save } from './core/save.js';
import { Audio } from './core/audio.js';
import { Assets, MANIFEST } from './core/assets.js';
import { FX } from './core/fx.js';
import { BootScene } from './scenes/boot.js';
import { MenuScene } from './scenes/menu.js';
import { PlayScene } from './scenes/play.js';
import { PauseScene } from './scenes/pause.js';
import { GameOverScene } from './scenes/gameover.js';
import { ShopScene } from './scenes/shop.js';
import { LevelSelectScene } from './scenes/levelselect.js';
import { LevelResultScene } from './scenes/levelresult.js';

function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('找不到 <canvas id="game">');

  // ---------- 引擎 ----------
  const engine = new Engine(canvas, { width: DESIGN_WIDTH, height: DESIGN_HEIGHT });

  // ---------- 系统 ----------
  const save = new Save();
  save.load();                       // 容错读档
  const audio = new Audio(save.settings);
  const fx = new FX();
  const assets = new Assets(MANIFEST);
  const input = new Input(engine);

  // 所有系统挂在一个 game 对象上，场景通过 this.game 拿到它们
  const game = { engine, save, audio, fx, assets, input, version: VERSION };

  // ---------- 场景栈 ----------
  const scenes = new SceneManager(game);
  game.scenes = scenes;
  scenes.register('boot', () => new BootScene(game));
  scenes.register('menu', () => new MenuScene(game));
  scenes.register('play', () => new PlayScene(game));
  scenes.register('pause', () => new PauseScene(game));
  scenes.register('gameover', () => new GameOverScene(game));
  scenes.register('shop', () => new ShopScene(game));
  // v1.2：闯关模式的两个页面（选关 + 关卡结算）
  scenes.register('levelselect', () => new LevelSelectScene(game));
  scenes.register('levelresult', () => new LevelResultScene(game));

  // ---------- 输入 ----------
  input.attach(document);
  // 浏览器要求音频必须在用户交互之后才能播放
  input.onFirstInput = () => audio.unlock();

  // ---------- 主循环：固定步长更新 + 插值渲染 ----------
  engine.onUpdate = (dt) => {
    input.update(dt);      // 累计按住时长
    scenes.update(dt);     // 只有最上面的场景会更新
    input.endFrame();      // 清掉“刚按下/刚松开”标记
  };
  engine.onRender = (alpha) => {
    engine.beginFrame();
    scenes.render(engine.ctx, alpha);
    engine.endFrame();
  };

  // ---------- 启动 ----------
  scenes.push('boot');
  scenes.flush();          // 立刻创建启动场景，避免第一帧黑屏
  engine.start();

  // ---------- Service Worker（离线可玩） ----------
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('[sw] 注册失败（不影响游戏）：', err);
      });
    });
  }

  // 方便在控制台里调试
  window.__NEON__ = game;
  return game;
}

try {
  boot();
} catch (err) {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = '启动失败：' + err.message;
}