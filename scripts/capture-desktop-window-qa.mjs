#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const channelIndex = argv.indexOf('--channel');
const outputIndex = argv.indexOf('--output-dir');
const channel = channelIndex >= 0 ? argv[channelIndex + 1] : 'qa';
const outputDir = path.resolve(outputIndex >= 0 ? argv[outputIndex + 1] : 'tools/performance/desktop-window-qa');
const productName = channel === 'production' ? 'Ritual' : channel === 'qa' ? 'Ritual QA' : 'Ritual Dev';
await mkdir(outputDir, { recursive: true });

const boundsScript = `tell application "System Events" to tell process "${productName}" to get {position, size} of front window`;
const boundsResult = spawnSync('/usr/bin/osascript', ['-e', boundsScript], { encoding: 'utf8' });
if (boundsResult.status !== 0) {
  throw new Error(`Could not resolve focused ${productName} window bounds: ${boundsResult.stderr.trim()}`);
}
const numbers = boundsResult.stdout.match(/-?\d+/g)?.map(Number) || [];
if (numbers.length < 4) throw new Error(`Unexpected window bounds: ${boundsResult.stdout.trim()}`);
const [x, y, width, height] = numbers;
const declaredProbePoints = {
  opaqueMainSurface: { xRatio: 0.75, yRatio: 0.5 },
  decorativeGlassRegion: { xRatio: 0.2, yRatio: 0.3 },
  hitTestTarget: { xRatio: 0.2, yRatio: 0.72 },
};
const hitPoint = {
  x: Math.round(x + width * declaredProbePoints.hitTestTarget.xRatio),
  y: Math.round(y + height * declaredProbePoints.hitTestTarget.yRatio),
};
const clickScript = `
tell application "System Events"
  tell process "${productName}"
    set frontmost to true
    click at {${hitPoint.x}, ${hitPoint.y}}
    delay 0.5
    return name of front window
  end tell
end tell`;
const clickResult = spawnSync('/usr/bin/osascript', ['-e', clickScript], { encoding: 'utf8' });
if (clickResult.status !== 0) {
  throw new Error(`Hit-test click failed: ${clickResult.stderr.trim()}`);
}
const windowTitleAfterClick = clickResult.stdout.trim();
if (!/Ritual Window Hit Test [1-9][0-9]*/.test(windowTitleAfterClick)) {
  throw new Error(`WKWebView did not acknowledge the declared hit-test click; title is ${windowTitleAfterClick}`);
}
const capturedAt = new Date().toISOString();
const fileStem = `${channel}-${capturedAt.replaceAll(/[:.]/g, '-')}`;
const screenshotPath = path.join(outputDir, `${fileStem}.png`);
const capture = spawnSync('/usr/sbin/screencapture', ['-x', '-R', `${x},${y},${width},${height}`, screenshotPath], { encoding: 'utf8' });
if (capture.status !== 0) throw new Error(capture.stderr || 'screencapture failed');
const screenshot = await readFile(screenshotPath);
const sharp = (await import('sharp')).default;
const { data: pixels, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sampledPoints = Object.fromEntries(Object.entries(declaredProbePoints).map(([name, point]) => {
  const sampleX = Math.min(info.width - 1, Math.max(0, Math.round(info.width * point.xRatio)));
  const sampleY = Math.min(info.height - 1, Math.max(0, Math.round(info.height * point.yRatio)));
  const offset = (sampleY * info.width + sampleX) * info.channels;
  return [name, {
    x: sampleX,
    y: sampleY,
    rgba: Array.from(pixels.subarray(offset, offset + 4)),
    alpha: pixels[offset + 3],
  }];
}));
if (sampledPoints.opaqueMainSurface.alpha !== 255 || sampledPoints.hitTestTarget.alpha !== 255) {
  throw new Error('Main or hit-test probe point is not fully opaque; keep the opaque fallback enabled.');
}
const artifact = {
  schemaVersion: 1,
  capturedAt,
  sourceSha: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  channel,
  productName,
  windowBounds: { x, y, width, height },
  declaredProbePoints,
  sampledPoints,
  hitTest: { point: hitPoint, windowTitleAfterClick, acknowledged: true },
  screenshot: path.basename(screenshotPath),
  screenshotSha256: createHash('sha256').update(screenshot).digest('hex'),
};
await writeFile(path.join(outputDir, `${fileStem}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify(artifact, null, 2));
