import { readJsonFile } from './store.mjs';

const schemaCache = new Map();

const schemaPathByName = {
  task: 'ai/runtime/schemas/task.schema.json',
  run: 'ai/runtime/schemas/run.schema.json',
  event: 'ai/runtime/schemas/event.schema.json',
  gate: 'ai/runtime/schemas/gate.schema.json',
  report: 'ai/runtime/schemas/report.schema.json',
  project: 'ai/runtime/schemas/project.schema.json',
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const formatPath = (pathSegments) => (pathSegments.length > 0 ? pathSegments.join('.') : 'value');

const resolveRef = (rootSchema, ref) => {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported schema ref: ${ref}`);
  }

  return ref
    .slice(2)
    .split('/')
    .reduce((current, segment) => current?.[segment], rootSchema);
};

const validateDateTime = (value) => !Number.isNaN(Date.parse(value));

const validateValue = (value, schema, rootSchema, pathSegments, errors) => {
  if (!schema) {
    errors.push(`${formatPath(pathSegments)} references an undefined schema node.`);
    return;
  }

  if (schema.$ref) {
    validateValue(value, resolveRef(rootSchema, schema.$ref), rootSchema, pathSegments, errors);
    return;
  }

  if (schema.anyOf) {
    const matched = schema.anyOf.some((candidate) => {
      const candidateErrors = [];
      validateValue(value, candidate, rootSchema, pathSegments, candidateErrors);
      return candidateErrors.length === 0;
    });

    if (!matched) {
      errors.push(`${formatPath(pathSegments)} does not satisfy any allowed schema variant.`);
    }
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${formatPath(pathSegments)} must be one of: ${schema.enum.join(', ')}.`);
    return;
  }

  if (Array.isArray(schema.type)) {
    const matched = schema.type.some((candidateType) => {
      const candidateErrors = [];
      validateValue(value, { ...schema, type: candidateType }, rootSchema, pathSegments, candidateErrors);
      return candidateErrors.length === 0;
    });

    if (!matched) {
      errors.push(`${formatPath(pathSegments)} must match one of the allowed types: ${schema.type.join(', ')}.`);
    }
    return;
  }

  switch (schema.type) {
    case 'object': {
      if (!isPlainObject(value)) {
        errors.push(`${formatPath(pathSegments)} must be an object.`);
        return;
      }

      const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
      for (const requiredKey of requiredKeys) {
        if (!(requiredKey in value)) {
          errors.push(`${formatPath([...pathSegments, requiredKey])} is required.`);
        }
      }

      const declaredProperties = schema.properties ?? {};
      for (const [key, propertySchema] of Object.entries(declaredProperties)) {
        if (key in value) {
          validateValue(value[key], propertySchema, rootSchema, [...pathSegments, key], errors);
        }
      }

      for (const key of Object.keys(value)) {
        if (key in declaredProperties) continue;

        if (schema.additionalProperties === false) {
          errors.push(`${formatPath([...pathSegments, key])} is not allowed.`);
          continue;
        }

        if (isPlainObject(schema.additionalProperties) || schema.additionalProperties?.type) {
          validateValue(value[key], schema.additionalProperties, rootSchema, [...pathSegments, key], errors);
        }
      }
      return;
    }

    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${formatPath(pathSegments)} must be an array.`);
        return;
      }

      if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        errors.push(`${formatPath(pathSegments)} must contain at least ${schema.minItems} item(s).`);
      }

      if (schema.items) {
        value.forEach((item, index) => {
          validateValue(item, schema.items, rootSchema, [...pathSegments, `[${index}]`], errors);
        });
      }
      return;
    }

    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${formatPath(pathSegments)} must be a string.`);
        return;
      }

      if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        errors.push(`${formatPath(pathSegments)} must be at least ${schema.minLength} character(s).`);
      }

      if (schema.format === 'date-time' && !validateDateTime(value)) {
        errors.push(`${formatPath(pathSegments)} must be a valid date-time string.`);
      }
      return;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(`${formatPath(pathSegments)} must be a boolean.`);
      }
      return;
    }

    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${formatPath(pathSegments)} must be a number.`);
      }
      return;
    }

    default:
      return;
  }
};

export const loadSchema = async (schemaName) => {
  if (schemaCache.has(schemaName)) {
    return schemaCache.get(schemaName);
  }

  const schemaPath = schemaPathByName[schemaName];
  if (!schemaPath) {
    throw new Error(`Unknown schema name: ${schemaName}`);
  }

  const schema = await readJsonFile(schemaPath);
  schemaCache.set(schemaName, schema);
  return schema;
};

export const validateBySchema = async (schemaName, value) => {
  const schema = await loadSchema(schemaName);
  const errors = [];
  validateValue(value, schema, schema, [], errors);
  return errors;
};

export const assertValidBySchema = async (schemaName, value, label) => {
  const errors = await validateBySchema(schemaName, value);
  if (errors.length === 0) return;

  throw new Error(`${label} failed ${schemaName} schema validation:\n- ${errors.join('\n- ')}`);
};
