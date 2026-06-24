/**
 * 第二批命令层只需要最小参数解析，先支持 `--run` 和 `--pipeline`。
 */
export const parseCliArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith('--')) continue;

    const [rawKey, inlineValue] = current.slice(2).split('=');
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith('--')) {
      options[rawKey] = nextValue;
      index += 1;
      continue;
    }

    options[rawKey] = 'true';
  }

  return options;
};
