/**
 * 看板写出层：把 RUN 运行态渲染成 HTML 并落盘。命令(ai:board / ai:overview)与 ai:run 复用,避免重复扫描逻辑。
 */
import { spawn } from 'node:child_process';
import { renderBoardHtml, renderOverviewHtml } from './board.mjs';
import { readAllRunEvents } from './events.mjs';
import { loadOrCreateRun, loadRunTasks } from './planner.mjs';
import { listRelativeFiles, readJsonFile, resolveRepoPath, writeTextFile } from './store.mjs';

const nowStamp = () => new Date().toISOString().replace('T', ' ').replace(/\..*$/, '');

// 看板产出目录：放在编排器自己的目录下(已在 .gitignore，属本地生成物)。
const DASH_DIR = 'tools/ai-orchestrator/dashboard';

/** 用系统默认浏览器打开一个仓库内相对路径的文件(best-effort，跨平台，失败只忽略)。 */
export const openInBrowser = (relativePath) => {
  const abs = resolveRepoPath(relativePath);
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', abs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [abs], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [abs], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 打不开就算了，文件已落盘，用户可手动打开 */
  }
};

/** 渲染单 RUN 看板到 ai/context/runs/<RUN>/board.html。 */
export const writeRunBoard = async (runId, { autoRefresh = 0, out } = {}) => {
  const run = await loadOrCreateRun(runId);
  const tasks = await loadRunTasks(run);
  const events = await readAllRunEvents(runId);
  const html = renderBoardHtml(run, tasks, events, { standalone: true, generatedAt: nowStamp(), autoRefresh });
  const path = out ?? `${DASH_DIR}/runs/${runId}/board.html`;
  await writeTextFile(path, html);
  return { path, taskCount: tasks.length };
};

/** 扫描所有 RUN(直读，不做 schema 校验，兼容历史/坏档)渲染总览到 ai/context/overview.html。 */
export const writeOverview = async ({ autoRefresh = 0, out } = {}) => {
  const files = await listRelativeFiles('ai/runtime/runs', '.json');
  const entries = [];
  for (const file of files) {
    try {
      const run = await readJsonFile(file);
      if (!run?.runId) continue;
      let tasks = [];
      try {
        tasks = await loadRunTasks(run);
      } catch {
        tasks = [];
      }
      entries.push({ run, tasks });
    } catch {
      /* 跳过无法读取的 run 文件，不中断总览 */
    }
  }
  const html = renderOverviewHtml(entries, { standalone: true, generatedAt: nowStamp(), autoRefresh });
  const path = out ?? `${DASH_DIR}/overview.html`;
  await writeTextFile(path, html);

  // 同时生成每条 RUN 的看板，保证总览卡片的「点进看板」链接不为空(best-effort，单个失败不影响总览)。
  for (const { run, tasks } of entries) {
    try {
      const events = await readAllRunEvents(run.runId);
      const boardHtml = renderBoardHtml(run, tasks, events, { standalone: true, generatedAt: nowStamp(), autoRefresh });
      await writeTextFile(`${DASH_DIR}/runs/${run.runId}/board.html`, boardHtml);
    } catch {
      /* 跳过无法渲染的 run，不中断总览 */
    }
  }

  return { path, runCount: entries.length };
};
