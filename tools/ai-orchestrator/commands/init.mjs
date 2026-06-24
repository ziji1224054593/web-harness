import { mkdir, readdir, writeFile } from 'node:fs/promises';

import { parseCliArgs } from '../runtime/cli.mjs';
import { resolveRepoPath } from '../runtime/store.mjs';

/**
 * ai:init —— 初始化一个干净的 Harness 工作区。
 *   - 创建运行时骨架目录(带 .gitkeep)
 *   - 若 ai/runtime/tasks 为空,写入一条示例任务链(可直接 ai:plan)
 *
 *   pnpm ai:init                  创建骨架 + 示例任务链
 *   pnpm ai:init -- --bare        只创建骨架目录,不写示例任务
 *   pnpm ai:init -- --force       即使已有任务文件也重写示例任务
 */
const options = parseCliArgs(process.argv.slice(2));
const bare = options.bare === 'true';
const force = options.force === 'true';

const RUNTIME_DIRS = [
  'ai/runtime/tasks',
  'ai/runtime/runs',
  'ai/runtime/locks',
  'ai/runtime/events',
  'ai/runtime/indexes',
  'ai/runtime/evidence',
  'ai/runtime/audit',
  'ai/context/runs',
];

const task = ({ id, title, type, owner, gate, dependsOn, status, output }) => {
  const deps = dependsOn.length === 0 ? 'dependsOn: []' : `dependsOn:\n  - ${dependsOn.join('\n  - ')}`;
  return `id: ${id}
title: ${title}
type: ${type}
ownerRole: ${owner}
priority: medium
${deps}
inputs: []
outputs:
  - ${output}
acceptance:
  - Replace this sample with a real acceptance criterion
gateTargets:
  - ${gate}
status: ${status}
evidenceRefs: []
`;
};

const SAMPLE_TASKS = {
  'SAMPLE-REQ-1.yaml': task({
    id: 'SAMPLE-REQ-1', title: 'Sample requirement refinement', type: 'requirement',
    owner: 'product', gate: 'G1', dependsOn: [], status: 'ready',
    output: 'ai/context/runs/RUN-SAMPLE-001/requirement.md',
  }),
  'SAMPLE-SCAN-1.yaml': task({
    id: 'SAMPLE-SCAN-1', title: 'Sample module scan', type: 'scan',
    owner: 'architecture', gate: 'G2', dependsOn: ['SAMPLE-REQ-1'], status: 'todo',
    output: 'ai/context/runs/RUN-SAMPLE-001/scan.md',
  }),
  'SAMPLE-SOL-1.yaml': task({
    id: 'SAMPLE-SOL-1', title: 'Sample solution alignment', type: 'solution',
    owner: 'lead_orchestrator', gate: 'G3', dependsOn: ['SAMPLE-SCAN-1'], status: 'todo',
    output: 'ai/context/runs/RUN-SAMPLE-001/run-summary.md',
  }),
  'SAMPLE-IMPL-1.yaml': task({
    id: 'SAMPLE-IMPL-1', title: 'Sample implementation', type: 'implementation',
    owner: 'frontend', gate: 'G4', dependsOn: ['SAMPLE-SOL-1'], status: 'todo',
    output: 'ai/context/runs/RUN-SAMPLE-001/implementation.md',
  }),
  'SAMPLE-VAL-1.yaml': task({
    id: 'SAMPLE-VAL-1', title: 'Sample validation', type: 'validation',
    owner: 'qa', gate: 'G5', dependsOn: ['SAMPLE-IMPL-1'], status: 'todo',
    output: 'ai/context/runs/RUN-SAMPLE-001/validation.md',
  }),
  'SAMPLE-REV-1.yaml': task({
    id: 'SAMPLE-REV-1', title: 'Sample delivery review', type: 'review',
    owner: 'review', gate: 'G6', dependsOn: ['SAMPLE-VAL-1'], status: 'todo',
    output: 'ai/context/runs/RUN-SAMPLE-001/review.md',
  }),
};

for (const dir of RUNTIME_DIRS) {
  const abs = resolveRepoPath(dir);
  await mkdir(abs, { recursive: true });
  await writeFile(resolveRepoPath(dir, '.gitkeep'), '', 'utf8');
}

const tasksDir = resolveRepoPath('ai/runtime/tasks');
const existing = (await readdir(tasksDir)).filter((name) => name.endsWith('.yaml'));

let wrote = 0;
if (!bare && (existing.length === 0 || force)) {
  for (const [name, body] of Object.entries(SAMPLE_TASKS)) {
    await writeFile(resolveRepoPath('ai/runtime/tasks', name), body, 'utf8');
    wrote += 1;
  }
}

console.log(`Harness initialized. Runtime dirs ready: ${RUNTIME_DIRS.length}.`);
if (wrote > 0) {
  console.log(`Wrote ${wrote} sample task(s) to ai/runtime/tasks/ (a full G1→G6 chain).`);
} else if (bare) {
  console.log('Skipped sample tasks (--bare). Add your own *.yaml under ai/runtime/tasks/.');
} else {
  console.log(`Left ${existing.length} existing task file(s) untouched (use --force to overwrite samples).`);
}
console.log('');
console.log('Next steps:');
console.log('  1) Edit ai/runtime/definitions/project.yaml (workspaceRoot + validation commands).');
console.log('  2) pnpm ai:validate-project');
console.log('  3) pnpm ai:plan -- --run RUN-SAMPLE-001');
console.log('  4) pnpm ai:overview            # open the generated dashboard');
