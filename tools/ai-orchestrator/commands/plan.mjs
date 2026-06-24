import { parseCliArgs } from '../runtime/cli.mjs';
import { appendRunEvent } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTasks, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const pipelineId = options.pipeline ?? 'page-delivery';

// 中文注释：plan 命令的职责是建立或刷新运行态，不直接执行任务。
const run = await loadOrCreateRun(runId, pipelineId);
// 新建 RUN：刚创建尚未落盘时 revision 为 0；用它判定是否首次建群，避免重复 plan 反复刷开场。
const isNewRun = (run.revision ?? 0) === 0;
const operator = options.by ?? run.orchestrationState?.primaryOwner ?? 'lead_orchestrator';
const tasks = await loadRunTasks(run);
const refreshedRun = await refreshRunState(run, tasks);

const savedRun = await persistRunContext({
  run: refreshedRun,
  operator,
  previousRun: run,
  tasks,
  action: 'plan run state',
});

// 建群：首次创建 RUN 时，由 Lead 在群里发一条开场播报，召集本轮参与身份。
if (isNewRun) {
  const ROLE_ORDER = ['product', 'architecture', 'ux', 'frontend', 'qa', 'review', 'lead_orchestrator', 'integration', 'backend', 'devops'];
  const roster = [...new Set(tasks.map((task) => task.ownerRole).filter(Boolean))];
  const ordered = ROLE_ORDER.filter((role) => roster.includes(role));
  const list = (ordered.length ? ordered : ['product', 'architecture', 'ux', 'frontend', 'qa', 'review']).join(' · ');
  await appendRunEvent(savedRun.runId, 'channel.message', {
    from: 'lead_orchestrator',
    to: 'all',
    kind: 'open',
    text: `🆕 任务对接群已建群，全员集合 — 参与身份：${list}；Pipeline：${savedRun.pipelineId}`,
  });
}

for (const task of tasks) {
  await appendRunEvent(
    savedRun.runId,
    task.status === 'ready' ? 'task.ready' : 'task.created',
    {
      status: task.status,
      ownerRole: task.ownerRole,
    },
    task.id
  );
}

console.log(`Planned run ${savedRun.runId}. Ready tasks: ${savedRun.readyQueue.join(', ') || 'none'}`);
