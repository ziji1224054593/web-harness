import { exec as execCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveValidationChecks } from './project-contract.mjs';
import { REPO_ROOT } from './store.mjs';

const exec = promisify(execCallback);
const MAX_OUTPUT_CHARS = 4000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const nowIso = () => new Date().toISOString();

const trimOutput = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();

  if (!normalized) return '';
  if (normalized.length <= MAX_OUTPUT_CHARS) return normalized;

  return normalized.slice(-MAX_OUTPUT_CHARS);
};

const runValidationCheck = async (check, projectContract) => {
  const startedAt = nowIso();
  const startedAtMs = Date.now();
  const cwd = path.resolve(REPO_ROOT, projectContract.workspaceRoot, check.runFrom ?? '.');

  try {
    const { stdout, stderr } = await exec(check.command, {
      cwd,
      maxBuffer: MAX_BUFFER_BYTES,
      shell: true,
      windowsHide: true,
    });

    return {
      checkId: check.checkId,
      command: check.command,
      description: check.description,
      cwd,
      status: 'passed',
      exitCode: 0,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startedAtMs,
      stdoutSnippet: trimOutput(stdout),
      stderrSnippet: trimOutput(stderr),
    };
  } catch (error) {
    const exitCode = typeof error?.code === 'number' ? error.code : null;
    const status = exitCode === null ? 'blocked' : 'failed';

    return {
      checkId: check.checkId,
      command: check.command,
      description: check.description,
      cwd,
      status,
      exitCode,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startedAtMs,
      stdoutSnippet: trimOutput(error?.stdout),
      stderrSnippet: trimOutput(error?.stderr || error?.message),
    };
  }
};

const buildValidationSummary = (task, results) => {
  const digest = results.map((result) => `${result.checkId}=${result.status}`).join(', ');
  const blockedChecks = results.filter((result) => result.status === 'blocked');
  const failedChecks = results.filter((result) => result.status === 'failed');

  if (blockedChecks.length > 0) {
    return `Validation blocked for ${task.title}: ${digest}.`;
  }

  if (failedChecks.length > 0) {
    return `Validation failed for ${task.title}: ${digest}.`;
  }

  return `Validation passed for ${task.title}: ${digest}.`;
};

const buildTaskStatus = (results) => {
  if (results.some((result) => result.status === 'blocked')) return 'blocked';
  if (results.some((result) => result.status === 'failed')) return 'failed';
  return 'done';
};

export const runValidationTask = async (task, projectContract) => {
  const { checks, invalidEntries } = resolveValidationChecks(task, projectContract);

  if (invalidEntries.length > 0) {
    return {
      taskId: task.id,
      status: 'blocked',
      summary: `Validation suite contains unsupported checks for ${task.title}.`,
      producedOutputs: [],
      evidence: [],
      notes: `unsupported=${invalidEntries.join(', ')}`,
    };
  }

  if (checks.length === 0) {
    return {
      taskId: task.id,
      status: 'blocked',
      summary: `Validation suite is empty for ${task.title}.`,
      producedOutputs: [],
      evidence: [],
      notes: 'No validation checks resolved from metadata.validationSuite.',
    };
  }

  const checkResults = [];
  for (const check of checks) {
    checkResults.push(await runValidationCheck(check, projectContract));
  }

  const status = buildTaskStatus(checkResults);
  const summary = buildValidationSummary(task, checkResults);
  const notes = checkResults
    .map((result) => `${result.checkId}=${result.status}${result.exitCode === null ? '' : `(${result.exitCode})`}`)
    .join(', ');

  return {
    taskId: task.id,
    status,
    summary,
    producedOutputs: task.outputs,
    evidence: checkResults.map((result, index) => ({
      evidenceId: `${task.id}-${result.checkId}-${Date.now()}-${index}`,
      kind: 'validation',
      path: `ai/runtime/evidence/${task.id}/${task.id}-${result.checkId}.json`,
      summary: `${result.checkId}: ${result.status} (${result.durationMs}ms)`,
      createdAt: result.finishedAt,
    })),
    notes,
    validationResults: checkResults,
  };
};
