// ============================================================
// sw.js —— 极简 Service Worker（网络优先 + 离线兜底）
// 目的：联网时永远拿最新代码，断网时还能继续玩。
//
// 【v1.1 修的一个重要坑】原来是「缓存优先」，结果改完代码后浏览器一直返回
// 旧缓存，新功能（商城/皮肤）怎么刷新都不出现，看起来就像"功能没做"。
// 所以改成「网络优先」：先请求网络，成功就顺手更新缓存；只有网络失败
// （断网 / 服务器没开）才回退到缓存，离线可玩的能力一点没少。
// 改完 sw.js 记得把下面的 CACHE_NAME 也换一个版本号，好让旧缓存被清掉。
// ============================================================

const CACHE_NAME = 'neon-dash-v6';   // 换一次版本号，激活时会删掉旧缓存（v1.3：无尽模式三种新机制）

// 需要预缓存的清单（相对 sw.js 所在目录）
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  // 应用图标：离线时「安装」提示也要能拿到图标
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './src/main.js',
  './src/config.js',
  './src/data/skins.js',
  './src/data/levels.js',           // v1.2：闯关关卡数据
  './src/core/engine.js',
  './src/core/input.js',
  './src/core/scenes.js',
  './src/core/save.js',
  './src/core/audio.js',
  './src/core/assets.js',
  './src/core/fx.js',
  './src/scenes/boot.js',
  './src/scenes/menu.js',
  './src/scenes/play.js',
  './src/scenes/pause.js',
  './src/scenes/gameover.js',
  './src/scenes/shop.js',
  './src/scenes/levelselect.js',    // v1.2：关卡选择页
  './src/scenes/levelresult.js',    // v1.2：关卡结算页
  './src/entities/player.js',
  './src/entities/spawner.js',
  './src/ui/hud.js',
];

// 安装：预缓存全部文件，然后立刻接管
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // 某个文件 404 会让 addAll 整体失败，这里只记录，不阻塞安装
        console.warn('[sw] 预缓存失败：', err);
      })
  );
});

// 激活：删掉旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// 请求：网络优先，失败才回退缓存
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 只处理同源请求（本项目本来也没有外部资源）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 网络通了：顺手把最新版本塞进缓存，供之后离线使用
        // （复制一份才能塞，因为 body 只能读一次）
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        // 网络失败（断网 / 服务器没开）：回退到缓存
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          // 缓存里也没有，且这是一次页面导航：退回首页
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'offline' });
        })
      )
  );
});