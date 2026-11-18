// Requires Chromium, FFmpeg (libx264), and ImageMagick on PATH; Node 22+.
// Run: node media/render-preview.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = fileURLToPath(new URL('.', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'pi-preview-'));
const profile = join(temporary, 'profile');
const browser = spawn('chromium', ['--headless', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' });
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await delay(100); }
  }
  if (!port) throw new Error('Chromium did not expose a debugging port within 10 seconds');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  };
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = ++id;
      const timeout = setTimeout(() => { pending.delete(request); reject(new Error(`${method} timed out`)); }, 15000);
      pending.set(request, {
        resolve: result => { clearTimeout(timeout); resolve(result); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const url = pathToFileURL(join(directory, 'preview-animation.html'));
  url.search = '?verify&t=0';
  await command('Page.navigate', { url: url.href });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('typeof window.renderAt === "function"')) break;
    if (attempt === 99) throw new Error('Animation did not load');
    await delay(50);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  const timing = await evaluate('window.previewTiming');
  const frameCount = Math.round(timing.duration * 10);
  const introFrames = Math.round(timing.intro * 10);
  for (let frame = 0; frame < frameCount; frame++) {
    const png = await evaluate(`window.renderAt(${frame / 10}); document.querySelector('canvas').toDataURL('image/png').split(',')[1]`);
    await writeFile(join(temporary, `${String(frame).padStart(4, '0')}.png`), Buffer.from(png, 'base64'));
  }
  for (const [name, time] of [['default', 3], ['efforts', timing.starts[1] + 5.8], ['displaced', timing.starts[2] + 2.8], ['pinned', timing.starts[3] + 5]]) {
    const png = await evaluate(`window.renderAt(${time}); document.querySelector('canvas').toDataURL('image/png').split(',')[1]`);
    await writeFile(join(temporary, `${name}.png`), Buffer.from(png, 'base64'));
  }
  const frames = join(temporary, '%04d.png');
  const poster = join(temporary, 'poster.png');
  execFileSync('magick', [join(directory, 'preview.png'), '-resize', '640x400', poster]);
  for (let frame = 0; frame < frameCount + introFrames; frame++) {
    const source = frame < introFrames ? poster : join(temporary, `${String(frame - introFrames).padStart(4, '0')}.png`);
    await copyFile(source, join(temporary, `gif-${String(frame).padStart(4, '0')}.png`));
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '10', '-i', join(temporary, 'gif-%04d.png'),
    '-vf', 'scale=320:200:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none',
    '-loop', '0', join(directory, 'preview-animation.gif')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '10', '-i', frames,
    '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(directory, 'preview-animation.mp4')]);
  execFileSync('magick', [join(temporary, 'default.png'), join(temporary, 'efforts.png'),
    join(temporary, 'displaced.png'), join(temporary, 'pinned.png'), '-resize', '320x200',
    '-append', join(tmpdir(), 'pi-animation-storyboard.png')]);
  console.log(`Rendered ${timing.duration + timing.intro}s GIF (320×200; ${timing.intro}s static intro), ${timing.duration}s MP4 (640×400), and /tmp/pi-animation-storyboard.png`);
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve));
  await rm(temporary, { recursive: true, force: true });
}
