import { loadProjectContract, validateProjectContract } from '../runtime/project-contract.mjs';

const projectContract = await loadProjectContract();
const result = await validateProjectContract(projectContract);

console.log(
  JSON.stringify(
    {
      projectId: projectContract.projectId,
      displayName: projectContract.displayName,
      source: projectContract.metadata.source,
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
    },
    null,
    2
  )
);

if (!result.ok) {
  process.exit(1);
}
