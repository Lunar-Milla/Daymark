// Daymark 主题验收截图：主题 × 场景 × 视口，输出 PNG 与一张总览页 qa-shots/index.html。
//
//   cd tools && npm install && npx playwright install chromium
//   node qa-shots.mjs                                # 全部主题、全部场景、默认视口
//   node qa-shots.mjs --themes ink,playful --scenes full,export --viewports phone,wide
//
// 页面在 index.html?qa=<场景>&theme=<主题> 下运行，使用夹具数据，不会读写真实存储。
// 有页面报错或主题检查报 error 时以非 0 退出。CHROME=/path/to/chrome 可指定浏览器。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pageUrl = pathToFileURL(join(root, "index.html")).href;
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  narrow: { width: 320, height: 640 },
  landscape: { width: 844, height: 390 },
  wide: { width: 1280, height: 800 },
};
const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1].split(",") : def;
};
const out = resolve(arg("out", [join(root, "qa-shots")])[0]);
const concurrency = +arg("jobs", ["4"])[0];

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const probe = await browser.newPage();
await probe.goto(pageUrl + "?qa=empty");
await probe.waitForFunction(() => window.__daymarkQA);
const meta = await probe.evaluate(() => window.__daymarkQA);
await probe.close();

const themes = arg("themes", meta.themes);
const scenes = arg("scenes", meta.scenes);
const viewports = arg("viewports", ["phone", "narrow", "wide"]);
const jobs = [];
for (const theme of themes) for (const scene of scenes) for (const vp of viewports) jobs.push({ theme, scene, vp });

const problems = [];
async function run({ theme, scene, vp }) {
  const page = await browser.newPage({ viewport: VIEWPORTS[vp] });
  page.on("pageerror", (e) => problems.push(`${theme}/${scene}/${vp}: ${e.message}`));
  await page.goto(`${pageUrl}?qa=${scene}&theme=${theme}`);
  await page.waitForFunction(() => document.documentElement.dataset.qaReady === "1", null, { timeout: 30000 });
  await page.waitForTimeout(400); // 等弹窗动画结束
  mkdirSync(join(out, theme), { recursive: true });
  await page.screenshot({ path: join(out, theme, `${scene}-${vp}.png`) });
  await page.close();
}
const queue = jobs.slice();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const j = queue.shift();
    try { await run(j); } catch (e) { problems.push(`${j.theme}/${j.scene}/${j.vp}: ${e.message.split("\n")[0]}`); }
  }
}));
await browser.close();

const checks = meta.checks;
const rows = themes.map((t) => {
  const notes = checks.filter((c) => c.theme === t).map((c) => `<li class="${c.level}">${c.msg}</li>`).join("");
  const cells = scenes.map((s) => `<figure><figcaption>${s}</figcaption>${viewports
    .map((v) => `<a href="${t}/${s}-${v}.png"><img loading="lazy" src="${t}/${s}-${v}.png" alt="${t} ${s} ${v}"></a>`).join("")}</figure>`).join("");
  return `<section><h2>${t}</h2>${notes ? `<ul>${notes}</ul>` : ""}<div class="grid">${cells}</div></section>`;
}).join("");
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Daymark QA</title>
<style>body{font:14px system-ui;margin:24px;background:#f4f4f4}h2{margin:32px 0 8px}.grid{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;background:#fff;padding:8px;border-radius:8px}figcaption{font-weight:600;margin-bottom:6px}
img{height:260px;margin-right:6px;border:1px solid #ddd}.warn{color:#a15c00}.error{color:#c00}</style>
<h1>Daymark 主题验收</h1><p>${jobs.length} 张截图 · 视口 ${viewports.join(" / ")}</p>${rows}`);

const errors = checks.filter((c) => c.level === "error");
console.log(`截图 ${jobs.length} 张 → ${out}/index.html`);
console.log(`主题检查：${errors.length} error，${checks.length - errors.length} warn`);
for (const c of checks) console.log(`  [${c.level}] ${c.theme}: ${c.msg}`);
for (const p of problems) console.log("  [page] " + p);
process.exit(errors.length || problems.length ? 1 : 0);
