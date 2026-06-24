import { access } from 'node:fs/promises';
import path from 'node:path';

import { validateBySchema } from './schema-validator.mjs';
import { readYamlFile, REPO_ROOT } from './store.mjs';

const DEFAULT_PROJECT_CONTRACT = {
  projectId: 'default-workspace',
  displayName: 'Default Workspace',
  workspaceRoot: '.',
  validation: {
    defaultSuite: ['lint', 'typecheck'],
    checks: [
      {
        checkId: 'lint',
        description: 'Lint placeholder (define your real command in project.yaml)',
        command: 'node --version',
        runFrom: '.',
        aliases: [],
      },
      {
        checkId: 'typecheck',
        description: 'Type-check placeholder (define your real command in project.yaml)',
        command: 'node --version',
        runFrom: '.',
        aliases: [],
      },
    ],
  },
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const ensureObject = (value) => (value && typeof value === 'object' ? value : {});

const normalizeStringArray = (value) => (Array.isArray(value) ? value.filter(isNonEmptyString).map((entry) => entry.trim()) : []);

const normalizeValidationCheck = (check, fallbackRunFrom) => {
  if (!check || typeof check !== 'object') {
    throw new Error('Project contract validation check must be an object.');
  }

  if (!isNonEmptyString(check.checkId)) {
    throw new Error('Project contract validation check is missing checkId.');
  }

  if (!isNonEmptyString(check.command)) {
    throw new Error(`Project contract validation check ${check.checkId} is missing command.`);
  }

  return {
    checkId: check.checkId.trim(),
    description: isNonEmptyString(check.description) ? check.description.trim() : `Project validation check ${check.checkId.trim()}`,
    command: check.command.trim(),
    runFrom: isNonEmptyString(check.runFrom) ? check.runFrom.trim() : fallbackRunFrom,
    aliases: normalizeStringArray(check.aliases),
  };
};

export const normalizeProjectContract = (rawContract, source) => {
  const candidate = ensureObject(rawContract);
  const workspaceRoot = isNonEmptyString(candidate.workspaceRoot) ? candidate.workspaceRoot.trim() : DEFAULT_PROJECT_CONTRACT.workspaceRoot;
  const rawChecks = Array.isArray(candidate.validation?.checks) ? candidate.validation.checks : DEFAULT_PROJECT_CONTRACT.validation.checks;
  const checks = rawChecks.map((check) => normalizeValidationCheck(check, workspaceRoot));
  const defaultSuite = normalizeStringArray(candidate.validation?.defaultSuite);

  return {
    projectId: isNonEmptyString(candidate.projectId) ? candidate.projectId.trim() : DEFAULT_PROJECT_CONTRACT.projectId,
    displayName: isNonEmptyString(candidate.displayName) ? candidate.displayName.trim() : DEFAULT_PROJECT_CONTRACT.displayName,
    workspaceRoot,
    validation: {
      defaultSuite: defaultSuite.length > 0 ? defaultSuite : checks.map((check) => check.checkId),
      checks,
    },
    metadata: {
      source,
    },
  };
};

const validateDirectoryHint = async (relativePath, label) => {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);

  try {
    await access(absolutePath);
    return null;
  } catch {
    return `${label} does not exist: ${relativePath}`;
  }
};

export const loadProjectContract = async () => {
  try {
    const contract = await readYamlFile('ai/runtime/definitions/project.yaml');
    return normalizeProjectContract(contract, 'ai/runtime/definitions/project.yaml');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return normalizeProjectContract(DEFAULT_PROJECT_CONTRACT, 'built-in-default');
    }

    throw error;
  }
};

export const validateProjectContract = async (projectContract) => {
  const errors = [];
  const warnings = [];
  const knownIds = new Set();
  const aliasOwners = new Map();
  const schemaErrors = await validateBySchema('project', projectContract);

  errors.push(...schemaErrors);

  if (!isNonEmptyString(projectContract.projectId)) {
    errors.push('projectId must be a non-empty string.');
  }

  if (!isNonEmptyString(projectContract.displayName)) {
    errors.push('displayName must be a non-empty string.');
  }

  if (!isNonEmptyString(projectContract.workspaceRoot)) {
    errors.push('workspaceRoot must be a non-empty string.');
  } else {
    const workspaceRootError = await validateDirectoryHint(projectContract.workspaceRoot, 'workspaceRoot');
    if (workspaceRootError) {
      errors.push(workspaceRootError);
    }
  }

  if (!Array.isArray(projectContract.validation?.checks) || projectContract.validation.checks.length === 0) {
    errors.push('validation.checks must declare at least one executable check.');
  }

  for (const check of projectContract.validation?.checks ?? []) {
    if (knownIds.has(check.checkId)) {
      errors.push(`Duplicate validation checkId detected: ${check.checkId}`);
    }
    knownIds.add(check.checkId);

    const runFromError = await validateDirectoryHint(
      path.join(projectContract.workspaceRoot, check.runFrom ?? '.'),
      `validation.checks[${check.checkId}].runFrom`
    );
    if (runFromError) {
      errors.push(runFromError);
    }

    for (const alias of check.aliases ?? []) {
      const existingOwner = aliasOwners.get(alias);
      if (existingOwner && existingOwner !== check.checkId) {
        errors.push(`Validation alias ${alias} is shared by ${existingOwner} and ${check.checkId}.`);
        continue;
      }

      if (knownIds.has(alias) && alias !== check.checkId) {
        errors.push(`Validation alias ${alias} conflicts with an existing checkId.`);
        continue;
      }

      aliasOwners.set(alias, check.checkId);
    }
  }

  for (const requestedCheckId of projectContract.validation?.defaultSuite ?? []) {
    if (!knownIds.has(requestedCheckId) && !aliasOwners.has(requestedCheckId)) {
      errors.push(`validation.defaultSuite references unknown check: ${requestedCheckId}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
};

export const resolveValidationChecks = (task, projectContract) => {
  const checks = projectContract.validation.checks;
  const lookup = new Map();

  for (const check of checks) {
    lookup.set(check.checkId, check);
    for (const alias of check.aliases) {
      lookup.set(alias, check);
    }
  }

  const requestedIds = isNonEmptyString(task.metadata?.validationSuite)
    ? task.metadata.validationSuite
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : projectContract.validation.defaultSuite;

  const resolvedChecks = [];
  const invalidEntries = [];

  for (const requestedId of requestedIds) {
    const check = lookup.get(requestedId);

    if (!check) {
      invalidEntries.push(requestedId);
      continue;
    }

    if (!resolvedChecks.some((candidate) => candidate.checkId === check.checkId)) {
      resolvedChecks.push(check);
    }
  }

  return {
    checks: resolvedChecks,
    invalidEntries,
  };
};
