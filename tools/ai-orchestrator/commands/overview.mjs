import { openInBrowser, writeOverview } from '../runtime/board-writer.mjs';
import { parseCliArgs } from '../runtime/cli.mjs';

/**
 * ai:overview —— 渲染「全部活跃 RUN 总览」页(可点进各 RUN 看板)。
 *   ai:overview                       渲染一次
 *   ai:overview -- --watch            自动重渲(默认每 5s),页面内置自动刷新
 *   ai:overview -- --watch --interval 3
 */
const options = parseCliArgs(process.argv.slice(2));
const watch = options.watch === 'true';
const interval = Math.max(2, Number(options.interval ?? 5));
const out = options.out;

const render = () => writeOverview({ autoRefresh: watch ? interval : 0, out });

const { path, runCount } = await render();
console.log(`Rendered RUN overview -> ${path} (${runCount} runs)`);

// --watch 默认自动打开浏览器；也可单独用 --open。--no-open 关闭。
if ((watch || options.open === 'true') && options['no-open'] !== 'true') {
  openInBrowser(path);
  console.log(`已在默认浏览器打开 ${path}`);
}

if (watch) {
  console.log(`Watching all runs, re-rendering every ${interval}s. 在浏览器打开 ${path},页面会自动刷新。Ctrl+C 停止。`);
  const tick = async () => {
    try {
      await render();
    } catch (error) {
      console.warn(`[overview][warn] 重渲失败(已忽略): ${error.message}`);
    }
    setTimeout(tick, interval * 1000);
  };
  setTimeout(tick, interval * 1000);
}
