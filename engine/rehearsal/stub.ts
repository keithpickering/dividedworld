/**
 * The stub's answers (docs/plans/2026-11-11-system-rehearsal-design.md, section 4): the least value a JSON schema
 * allows, which `--stub` hands back for every chat call so the whole week's wiring runs at no cost and the repair
 * step does what it does with it. An object holds its required properties only, an array is empty (or holds
 * `minItems` of the least item), a string is `stub` (cut or repeated to `minLength`), a number is `minimum` or 0, and
 * an enum, `anyOf` or `oneOf` gives its first. Pure and browser-safe; the answer is placeholder words, never content.
 */
type Schema = Readonly<Record<string, unknown>>;

const isSchema = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

export function leastAnswer(schema: Schema): unknown {
  if ('const' in schema) return schema['const'];
  if (Array.isArray(schema['enum']) && schema['enum'].length > 0) return schema['enum'][0];
  for (const key of ['anyOf', 'oneOf']) {
    const first = (schema[key] as unknown[] | undefined)?.[0];
    if (isSchema(first)) return leastAnswer(first);
  }
  const given = schema['type'];
  const type = Array.isArray(given) ? given.find((t) => t !== 'null') ?? given[0] : given;
  switch (type) {
    case 'string': {
      const least = typeof schema['minLength'] === 'number' ? schema['minLength'] : 0;
      return least > 4 ? 'stub'.repeat(Math.ceil(least / 4)).slice(0, least) : 'stub';
    }
    case 'number':
    case 'integer': {
      const min = schema['minimum'];
      const over = schema['exclusiveMinimum'];
      if (typeof min === 'number') return min;
      if (typeof over === 'number') return type === 'integer' ? Math.floor(over) + 1 : over + 1;
      return 0;
    }
    case 'boolean': return false;
    case 'null': return null;
    case 'array': {
      const items = isSchema(schema['items']) ? schema['items'] : {};
      const least = typeof schema['minItems'] === 'number' ? schema['minItems'] : 0;
      return Array.from({ length: least }, () => leastAnswer(items));
    }
    case 'object': {
      const properties = isSchema(schema['properties']) ? schema['properties'] : {};
      const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
      return Object.fromEntries(required.map((k) => [k, isSchema(properties[k]) ? leastAnswer(properties[k] as Schema) : {}]));
    }
    default: return {};
  }
}
