/**
 * What a provider's structured output accepts, as one dated table, the way
 * `supabase/functions/_shared/models/prices.ts` holds prices. The first live rehearsal's
 * every meeting closed `failed` on a schema the provider refuses (`{}`, then too many optional
 * parameters, then a grammar too large), and the stub took each of them, since it answers any schema.
 * So the rules are data with a verification date, and `schemaProblems` holds a request's schema to them
 * before anything is sent, in every mode. A new provider adds its own measured rules; a request is held
 * to the rules of the provider it goes to. A bound the schema cannot carry lives in the rule
 * (`engine/system/validate.ts`), which the repair holds after the fact.
 *
 * Predicates name a problem the way a repair names a failed bound: `emptySchema`, `keyword(<name>)`,
 * `type(<name>)`, `closedObject`, `minItems(<n>)`, `requiredUnknown(<key>)`, and the four counts. The argument is consistent by
 * kind: where the schema holds a forbidden thing, it is the thing found (`keyword(maxItems)`,
 * `type(null)`, `minItems(2)`); where a count passes a limit, it is the limit
 * (`optionalPerObject(8)`), so a failure reads against the table. `requiredUnknown(<key>)` is a `required` that
 * names a key the object's `properties` does not hold (at the object). A keyword whose value is the wrong shape
 * (`anyOf` or `required` that is not an array) is reported as `keyword(anyOf)` or `keyword(required)`, at the node.
 * Tuple `items` (an array of schemas) is `type(tuple)` at `<path>.items`, and is not walked. `emptySchema` does
 * not hide a forbidden keyword on the same node: both are reported. Paths read like a repair's
 * (`properties.moves.items.properties.params`; an `anyOf` branch is `anyOf.<index>`). A problem with one
 * schema node is at that node; `optionalPerObject` is at the object; the three whole-schema totals
 * are at the root, which is the empty path ''.
 *
 * Pure, and imports nothing: the engine never knows which provider's client is behind it.
 */

export interface SchemaRules {
  /** The provider these rules were measured on. */
  readonly provider: string;
  /** The date the rules were last checked against the provider, as the price table dates its rows. */
  readonly verifiedOn: string;
  /** Where each rule came from. */
  readonly source: string;
  /** The keywords a schema node may carry. Nothing else. */
  readonly keywords: readonly string[];
  /** The values `type` may take. */
  readonly types: readonly string[];
  /** Every object must say `additionalProperties: false`. */
  readonly closedObjects: boolean;
  /** The values `minItems` may take; `maxItems` is not a keyword at all. */
  readonly minItems: readonly number[];
  /** Most optional properties (keys of `properties` not in `required`) in one object. */
  readonly optionalPerObject: number;
  /** Most optional properties in the whole schema. */
  readonly optionalTotal: number;
  /** Most `anyOf` in the whole schema. */
  readonly unionsTotal: number;
  /** Most properties (every key of every `properties`, through items and branches) in the whole schema. */
  readonly propertiesTotal: number;
}

export const ANTHROPIC_SCHEMA_RULES: SchemaRules = {
  provider: 'anthropic',
  verifiedOn: '2026-11-11',
  source:
    'platform.claude.com/docs/en/build-with-claude/structured-outputs (read 2026-11-11); probes, provider schemas design, section 0',
  keywords: ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'description', 'minItems'],
  types: ['object', 'array', 'string', 'number', 'integer', 'boolean'],
  closedObjects: true,
  // Published: "minItems" of 0 or 1 only; "maxItems is not supported" was a 400 on the patrol schema.
  minItems: [0, 1],
  // Measured, not published: flat objects of 4, 8 and 12 optional strings compiled in 2 s, 5 s and 41 s, and 24
  // took 180 s and was refused as too complex; 8 is the last size that compiles in seconds.
  optionalPerObject: 8,
  // Published: 24 optional parameters in the whole schema ("too many optional parameters (32), limit 24").
  optionalTotal: 24,
  // Published: 16 union-typed parameters in the whole schema.
  unionsTotal: 16,
  // A proxy for the unpublished grammar-size limit: set under the 46 properties the probes accepted and the 49
  // they refused (memory, orders, profile, inherited, successor accepted; adding patrols refused).
  propertiesTotal: 40,
};

export interface SchemaProblem {
  readonly path: string;
  readonly predicate: string;
}

/** The keywords that say what a node holds; a node with none of them accepts any JSON value. */
const says = ['type', 'anyOf', 'enum', 'const', 'properties', 'items'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The problems in `schema` against `rules`, in the order the walk meets them, then the totals. Empty when the schema is accepted. */
export function schemaProblems(schema: unknown, rules: SchemaRules = ANTHROPIC_SCHEMA_RULES): readonly SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  let optional = 0;
  let unions = 0;
  let properties = 0;
  const join = (path: string, part: string) => (path === '' ? part : `${path}.${part}`);

  const walk = (node: unknown, path: string): void => {
    if (!isRecord(node)) {
      problems.push({ path, predicate: 'emptySchema' });
      return;
    }
    for (const key of Object.keys(node)) {
      if (!rules.keywords.includes(key)) problems.push({ path, predicate: `keyword(${key})` });
    }
    // A node that says nothing about what it holds accepts any JSON value; its keywords were checked first.
    if (!says.some((k) => k in node)) {
      problems.push({ path, predicate: 'emptySchema' });
      return;
    }
    if (node.anyOf !== undefined && !Array.isArray(node.anyOf)) problems.push({ path, predicate: 'keyword(anyOf)' });
    if (node.required !== undefined && !Array.isArray(node.required)) problems.push({ path, predicate: 'keyword(required)' });
    if (node.type !== undefined && !(typeof node.type === 'string' && rules.types.includes(node.type))) {
      problems.push({ path, predicate: `type(${String(node.type)})` });
    }
    if (typeof node.minItems === 'number' && !rules.minItems.includes(node.minItems)) {
      problems.push({ path, predicate: `minItems(${node.minItems})` });
    }
    if (node.type === 'object' || isRecord(node.properties)) {
      if (rules.closedObjects && node.additionalProperties !== false) problems.push({ path, predicate: 'closedObject' });
      const props = isRecord(node.properties) ? node.properties : {};
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      const keys = Object.keys(props);
      if (Array.isArray(node.required)) {
        for (const r of node.required) if (!keys.includes(String(r))) problems.push({ path, predicate: `requiredUnknown(${String(r)})` });
      }
      const optionalHere = keys.filter((k) => !required.has(k)).length;
      if (optionalHere > rules.optionalPerObject) problems.push({ path, predicate: `optionalPerObject(${rules.optionalPerObject})` });
      optional += optionalHere;
      properties += keys.length;
      for (const k of keys) walk(props[k], join(join(path, 'properties'), k));
    }
    // An array that names no items holds any value, as `{}` would, and the provider refuses that the same way.
    if (Array.isArray(node.items)) problems.push({ path: join(path, 'items'), predicate: 'type(tuple)' });
    else if (node.items !== undefined) walk(node.items, join(path, 'items'));
    else if (node.type === 'array') problems.push({ path: join(path, 'items'), predicate: 'emptySchema' });
    if (Array.isArray(node.anyOf)) {
      unions += 1;
      node.anyOf.forEach((branch, i) => walk(branch, join(join(path, 'anyOf'), String(i))));
    }
  };

  walk(schema, '');
  if (optional > rules.optionalTotal) problems.push({ path: '', predicate: `optionalTotal(${rules.optionalTotal})` });
  if (unions > rules.unionsTotal) problems.push({ path: '', predicate: `unionsTotal(${rules.unionsTotal})` });
  if (properties > rules.propertiesTotal) problems.push({ path: '', predicate: `propertiesTotal(${rules.propertiesTotal})` });
  return problems;
}
