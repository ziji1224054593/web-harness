import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProjectContract, resolveValidationChecks, validateProjectContract } from '../runtime/project-contract.mjs';

test('normalizeProjectContract fills missing validation defaults', () => {
  const contract = normalizeProjectContract(
    {
      projectId: 'demo-project',
      displayName: 'Demo Project',
      workspaceRoot: '.',
      validation: {
        checks: [
          {
            checkId: 'lint',
            description: 'Lint',
            command: 'pnpm lint',
          },
        ],
      },
    },
    'test-source'
  );

  assert.equal(contract.projectId, 'demo-project');
  assert.deepEqual(contract.validation.defaultSuite, ['lint']);
  assert.equal(contract.validation.checks[0].runFrom, '.');
  assert.equal(contract.metadata.source, 'test-source');
});

test('resolveValidationChecks supports aliases and deduplicates matches', () => {
  const contract = normalizeProjectContract(
    {
      projectId: 'demo-project',
      displayName: 'Demo Project',
      workspaceRoot: '.',
      validation: {
        defaultSuite: ['lint'],
        checks: [
          {
            checkId: 'lint',
            description: 'Lint',
            command: 'pnpm lint',
            aliases: ['eslint'],
          },
          {
            checkId: 'typecheck',
            description: 'Typecheck',
            command: 'pnpm typecheck',
            aliases: ['tsc'],
          },
        ],
      },
    },
    'test-source'
  );

  const resolved = resolveValidationChecks(
    {
      metadata: {
        validationSuite: 'eslint,lint,tsc',
      },
    },
    contract
  );

  assert.deepEqual(
    resolved.checks.map((check) => check.checkId),
    ['lint', 'typecheck']
  );
  assert.deepEqual(resolved.invalidEntries, []);
});

test('resolveValidationChecks falls back to default suite when task metadata is empty', () => {
  const contract = normalizeProjectContract(
    {
      projectId: 'demo-project',
      displayName: 'Demo Project',
      workspaceRoot: '.',
      validation: {
        defaultSuite: ['lint', 'typecheck'],
        checks: [
          {
            checkId: 'lint',
            description: 'Lint',
            command: 'pnpm lint',
          },
          {
            checkId: 'typecheck',
            description: 'Typecheck',
            command: 'pnpm typecheck',
          },
        ],
      },
    },
    'test-source'
  );

  const resolved = resolveValidationChecks({ metadata: {} }, contract);

  assert.deepEqual(
    resolved.checks.map((check) => check.checkId),
    ['lint', 'typecheck']
  );
  assert.deepEqual(resolved.invalidEntries, []);
});

test('validateProjectContract reports schema-level integration issues', async () => {
  const contract = normalizeProjectContract(
    {
      projectId: 'broken-project',
      displayName: 'Broken Project',
      workspaceRoot: '.',
      validation: {
        defaultSuite: ['missing-check'],
        checks: [
          {
            checkId: 'lint',
            description: 'Lint',
            command: 'pnpm lint',
            aliases: ['shared'],
          },
          {
            checkId: 'typecheck',
            description: 'Typecheck',
            command: 'pnpm typecheck',
            aliases: ['shared'],
            runFrom: 'missing-directory',
          },
        ],
      },
    },
    'test-source'
  );

  const result = await validateProjectContract(contract);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /missing-check/);
  assert.match(result.errors.join('\n'), /shared/);
  assert.match(result.errors.join('\n'), /missing-directory/);
  assert.deepEqual(result.warnings, []);
});
