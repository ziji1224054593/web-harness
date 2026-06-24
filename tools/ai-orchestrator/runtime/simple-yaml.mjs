/**
 * 这是一个只服务当前编排器资产的最小 YAML 解析/序列化工具。
 * 它不追求完整 YAML 兼容性，只支持本仓库当前用到的对象、数组和标量结构。
 */

const countIndent = (line) => line.length - line.trimStart().length;

const splitKeyValue = (content) => {
  const separatorIndex = content.indexOf(':');

  if (separatorIndex === -1) {
    throw new Error(`Invalid YAML line: ${content}`);
  }

  return {
    key: content.slice(0, separatorIndex).trim(),
    rawValue: content.slice(separatorIndex + 1).trim(),
  };
};

const parseScalar = (rawValue) => {
  if (rawValue === '[]') return [];
  if (rawValue === '{}') return {};
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  if (/^-?\d+$/.test(rawValue)) return Number(rawValue);

  if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    return rawValue.slice(1, -1);
  }

  return rawValue;
};

const normalizeLines = (content) =>
  content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));

const parseBlock = (lines, startIndex, indent) => {
  const currentLine = lines[startIndex];
  if (!currentLine) {
    return { value: {}, nextIndex: startIndex };
  }

  if (countIndent(currentLine) === indent && currentLine.trimStart().startsWith('- ')) {
    return parseArray(lines, startIndex, indent);
  }

  return parseObject(lines, startIndex, indent);
};

const parseObject = (lines, startIndex, indent) => {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const lineIndent = countIndent(line);

    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw new Error(`Unexpected indentation in YAML object: ${line}`);
    }

    const trimmed = line.trimStart();
    if (trimmed.startsWith('- ')) break;

    const { key, rawValue } = splitKeyValue(trimmed);

    if (rawValue.length > 0) {
      result[key] = parseScalar(rawValue);
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];
    if (!nextLine || countIndent(nextLine) <= indent) {
      result[key] = {};
      index += 1;
      continue;
    }

    const nextTrimmed = nextLine.trim();
    if (nextTrimmed === '[]' || nextTrimmed === '{}') {
      result[key] = parseScalar(nextTrimmed);
      index += 2;
      continue;
    }

    const nested = parseBlock(lines, index + 1, indent + 2);
    result[key] = nested.value;
    index = nested.nextIndex;
  }

  return { value: result, nextIndex: index };
};

const parseArray = (lines, startIndex, indent) => {
  const result = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const lineIndent = countIndent(line);

    if (lineIndent < indent) break;
    if (lineIndent !== indent || !line.trimStart().startsWith('- ')) break;

    const trimmed = line.trimStart().slice(2).trim();

    if (trimmed.length === 0) {
      const nested = parseBlock(lines, index + 1, indent + 2);
      result.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    if (trimmed.includes(':')) {
      const { key, rawValue } = splitKeyValue(trimmed);
      const item = {
        [key]: rawValue.length > 0 ? parseScalar(rawValue) : {},
      };

      index += 1;

      while (index < lines.length) {
        const nestedLine = lines[index];
        const nestedIndent = countIndent(nestedLine);

        if (nestedIndent <= indent) break;
        if (nestedIndent !== indent + 2) {
          throw new Error(`Unexpected indentation in YAML array item: ${nestedLine}`);
        }

        const nestedContent = nestedLine.trimStart();
        const nestedPair = splitKeyValue(nestedContent);

        if (nestedPair.rawValue.length > 0) {
          item[nestedPair.key] = parseScalar(nestedPair.rawValue);
          index += 1;
          continue;
        }

        const nestedBlock = parseBlock(lines, index + 1, indent + 4);
        item[nestedPair.key] = nestedBlock.value;
        index = nestedBlock.nextIndex;
      }

      result.push(item);
      continue;
    }

    result.push(parseScalar(trimmed));
    index += 1;
  }

  return { value: result, nextIndex: index };
};

export const parseYaml = (content) => {
  const lines = normalizeLines(content);

  if (lines.length === 0) return {};

  return parseBlock(lines, 0, countIndent(lines[0])).value;
};

const formatScalar = (value) => {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') return JSON.stringify(value);

  if (value.length === 0) return '""';

  const needsQuote = /[:#[\]{}]|^\s|\s$/.test(value);
  return needsQuote ? JSON.stringify(value) : value;
};

const stringifyValue = (value, indent) => {
  const indentation = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${indentation}[]`;

    return value
      .map((item) => {
        if (Array.isArray(item) || (item && typeof item === 'object')) {
          if (Array.isArray(item) && item.length === 0) return `${indentation}- []`;

          const entries = Array.isArray(item) ? [] : Object.entries(item);
          if (!Array.isArray(item) && entries.length > 0) {
            const [firstKey, firstValue] = entries[0];
            const firstLine =
              Array.isArray(firstValue) || (firstValue && typeof firstValue === 'object')
                ? `${indentation}- ${firstKey}:`
                : `${indentation}- ${firstKey}: ${formatScalar(firstValue)}`;

            const restLines = [];

            for (const [key, nestedValue] of entries.slice(1)) {
              if (Array.isArray(nestedValue) || (nestedValue && typeof nestedValue === 'object')) {
                restLines.push(`${' '.repeat(indent + 2)}${key}:`);
                restLines.push(stringifyValue(nestedValue, indent + 4));
              } else {
                restLines.push(`${' '.repeat(indent + 2)}${key}: ${formatScalar(nestedValue)}`);
              }
            }

            if (Array.isArray(firstValue) || (firstValue && typeof firstValue === 'object')) {
              restLines.unshift(stringifyValue(firstValue, indent + 4));
            }

            return [firstLine, ...restLines].join('\n');
          }
        }

        return `${indentation}- ${formatScalar(item)}`;
      })
      .join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${indentation}{}`;

    return entries
      .map(([key, nestedValue]) => {
        if (Array.isArray(nestedValue) && nestedValue.length === 0) {
          return `${indentation}${key}: []`;
        }

        if (nestedValue && typeof nestedValue === 'object' && Object.keys(nestedValue).length === 0) {
          return `${indentation}${key}: {}`;
        }

        if (Array.isArray(nestedValue) || (nestedValue && typeof nestedValue === 'object')) {
          return `${indentation}${key}:\n${stringifyValue(nestedValue, indent + 2)}`;
        }

        return `${indentation}${key}: ${formatScalar(nestedValue)}`;
      })
      .join('\n');
  }

  return `${indentation}${formatScalar(value)}`;
};

export const stringifyYaml = (value) => `${stringifyValue(value, 0)}\n`;
