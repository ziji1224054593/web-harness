import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml, stringifyYaml } from './simple-yaml.mjs';

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIRECTORY = path.dirname(CURRENT_FILE_PATH);

/**
 * 编排器作为独立子包运行时，仓库根目录不能再依赖 process.cwd()。
 * 这里直接根据当前 runtime 文件位置回溯到业务仓根目录。
 */
export const REPO_ROOT = path.resolve(CURRENT_DIRECTORY, '..', '..', '..');

export const resolveRepoPath = (...segments) => path.join(REPO_ROOT, ...segments);

const ensureDirectory = async (targetFilePath) => {
  await mkdir(path.dirname(targetFilePath), { recursive: true });
};

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

export const safeReadTextFile = async (relativePath) => {
  try {
    return await readFile(resolveRepoPath(relativePath), 'utf8');
  } catch {
    return null;
  }
};

export const pathExists = async (relativePath) => {
  try {
    await stat(resolveRepoPath(relativePath));
    return true;
  } catch {
    return false;
  }
};

export const statRelativePath = async (relativePath) => {
  try {
    return await stat(resolveRepoPath(relativePath));
  } catch {
    return null;
  }
};

export const readJsonFile = async (relativePath) => {
  const absolutePath = resolveRepoPath(relativePath);
  const content = await readFile(absolutePath, 'utf8');
  return JSON.parse(content);
};

export const writeJsonFile = async (relativePath, value) => {
  const absolutePath = resolveRepoPath(relativePath);
  await ensureDirectory(absolutePath);
  const tempPath = `${absolutePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, absolutePath);
};

export const readYamlFile = async (relativePath) => {
  const absolutePath = resolveRepoPath(relativePath);
  const content = await readFile(absolutePath, 'utf8');
  return parseYaml(content);
};

export const writeYamlFile = async (relativePath, value) => {
  const absolutePath = resolveRepoPath(relativePath);
  await ensureDirectory(absolutePath);
  const tempPath = `${absolutePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tempPath, stringifyYaml(value), 'utf8');
  await rename(tempPath, absolutePath);
};

export const writeTextFile = async (relativePath, content) => {
  const absolutePath = resolveRepoPath(relativePath);
  await ensureDirectory(absolutePath);
  const tempPath = `${absolutePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, absolutePath);
};

export const appendTextFile = async (relativePath, content) => {
  const absolutePath = resolveRepoPath(relativePath);
  await ensureDirectory(absolutePath);
  await appendFile(absolutePath, content, 'utf8');
};

export const listRelativeFiles = async (relativeDirectory, extension) => {
  const absoluteDirectory = resolveRepoPath(relativeDirectory);
  // 目录不存在时返回空列表：支持「从零」状态与 ai/runtime/ 被 gitignore 后的全新检出，
  // 此时无任何任务定义，应安全返回空集而非崩溃。
  let fileNames;
  try {
    fileNames = await readdir(absoluteDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(extension))
    .sort()
    .map((fileName) => path.posix.join(relativeDirectory.replace(/\\/g, '/'), fileName));
};

export const withDirectoryLock = async (relativeLockPath, operator, action, callback, { timeoutMs = 15000, retryMs = 150, staleMs = 60000 } = {}) => {
  const absoluteLockDirectory = resolveRepoPath(relativeLockPath);
  await mkdir(path.dirname(absoluteLockDirectory), { recursive: true });
  const startedAt = Date.now();
  const ownerRecordPath = path.join(absoluteLockDirectory, 'owner.json');

  while (true) {
    try {
      await mkdir(absoluteLockDirectory);
      await writeFile(
        ownerRecordPath,
        `${JSON.stringify({
          operator,
          action,
          acquiredAt: new Date().toISOString(),
        })}\n`,
        'utf8'
      );
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const lockStats = await statRelativePath(relativeLockPath);
      const isStale = lockStats ? Date.now() - lockStats.mtimeMs > staleMs : false;

      if (isStale) {
        await rm(absoluteLockDirectory, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        const ownerRecord = await safeReadTextFile(path.posix.join(relativeLockPath.replace(/\\/g, '/'), 'owner.json'));
        throw new Error(`Timed out acquiring lock ${relativeLockPath} for ${action}.${ownerRecord ? ` Current lock: ${ownerRecord.trim()}` : ''}`);
      }

      await sleep(retryMs);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(absoluteLockDirectory, { recursive: true, force: true });
  }
};
