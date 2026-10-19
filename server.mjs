// ============================================================
// server.mjs —— 零依赖静态服务器
// 只用 Node 内置的 http / fs / path / os，不需要 npm install。
// 启动：node server.mjs   （或双击 start.bat）
// 默认端口 5180，可用环境变量 PORT 覆盖：PORT=8080 node server.mjs
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5180;

// ---------- MIME 类型表 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// ---------- 把 URL 路径安全地映射到本地文件 ----------
// 关键点：解析之后必须仍位于 ROOT 之内，否则就是目录穿越（../..）。
function resolveSafe(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  const full = path.resolve(ROOT, '.' + path.posix.normalize(rel));
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

  // 必须等于 ROOT（不可能，因为总有文件名）或以 ROOT + 分隔符 开头
  if (full !== ROOT && !full.startsWith(rootWithSep)) return null;
  return full;
}

// ---------- 统一的响应助手 ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',   // 开发时永远拿最新代码
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, '405 只支持 GET / HEAD');
  }

  const file = resolveSafe(req.url || '/');
  if (!file) return send(res, 403, '403 禁止访问');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      // 没找到文件时，如果看着像一次页面导航，就回退到首页
      return send(res, 404, '404 找不到 ' + req.url);
    }

    const headers = {
      'Content-Type': mimeOf(file),
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      // 允许将来放字体/图片等跨源资源（当前没有用到）
      'Access-Control-Allow-Origin': '*',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }

    const stream = fs.createReadStream(file);
    stream.on('error', () => send(res, 500, '500 读取文件失败'));
    res.writeHead(200, headers);
    stream.pipe(res);
  });
});

// ---------- 找出本机局域网 IP，方便手机访问 ----------
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // 跳过 IPv6 和内部回环地址
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  const lines = [
    '',
    '  霓虹冲刺 Neon Dash —— 静态服务器已启动',
    '',
    '  本机访问：   http://localhost:' + PORT,
  ];
  for (const ip of lanAddresses()) {
    lines.push('  手机访问：   http://' + ip + ':' + PORT + '   （手机需与电脑同一 WiFi）');
  }
  lines.push('', '  按 Ctrl+C 停止', '');
  console.log(lines.join('\n'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。换个端口再试，例如：set PORT=8080 && node server.mjs');
  } else {
    console.error('服务器出错：', err);
  }
  process.exit(1);
});