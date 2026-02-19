/**
 * JSON Schema → TypeBox Converter
 *
 * Converts JSON Schema objects (as returned by Cortex MCP tools) into
 * TypeBox schemas that the OpenClaw plugin API expects for tool parameter
 * definitions.
 *
 * Handles nested objects, arrays, enums, required/optional fields, and
 * common JSON Schema patterns used by MCP tool definitions.
 */

import { Type, type TSchema } from "@sinclair/typebox";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  const?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

type RefResolver = (ref: string) => JsonSchema | undefined;

function buildRefResolver(rootSchema: JsonSchema): RefResolver {
  const defs =
    (rootSchema as Record<string, unknown>)["$defs"] ??
    (rootSchema as Record<string, unknown>)["definitions"];
  if (!defs || typeof defs !== "object") {
    return () => undefined;
  }
  const map = defs as Record<string, JsonSchema>;
  return (ref: string) => {
    const name = ref.replace(/^#\/(\$defs|definitions)\//, "");
    return map[name];
  };
}

function convertSchema(schema: JsonSchema, resolve: RefResolver): TSchema {
  if (schema.$ref) {
    const resolved = resolve(schema.$ref);
    if (resolved) {
      return convertSchema(resolved, resolve);
    }
    return Type.Any();
  }

  if (schema.const !== undefined) {
    return Type.Literal(schema.const as string | number | boolean);
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    if (schema.enum.every((v) => typeof v === "string")) {
      return Type.Unsafe({ type: "string", enum: schema.enum });
    }
    return Type.Any();
  }

  if (schema.allOf && schema.allOf.length > 0) {
    if (schema.allOf.length === 1) {
      return convertSchema(schema.allOf[0], resolve);
    }
    return Type.Intersect(schema.allOf.map((s) => convertSchema(s, resolve)));
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    // TypeBox Union triggers anyOf which violates tool schema guardrails.
    // Pick the first branch as a best-effort approximation.
    return convertSchema(schema.oneOf[0], resolve);
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    return convertSchema(schema.anyOf[0], resolve);
  }

  const type = schema.type;

  if (type === "object" || (schema.properties && !type)) {
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries: Record<string, TSchema> = {};

    for (const [key, propSchema] of Object.entries(props)) {
      const converted = convertSchema(propSchema, resolve);
      entries[key] = required.has(key) ? converted : Type.Optional(converted);
    }

    return Type.Object(entries);
  }

  if (type === "array") {
    const items = schema.items ? convertSchema(schema.items, resolve) : Type.Any();
    return Type.Array(items);
  }

  if (type === "string") {
    return Type.String();
  }

  if (type === "number" || type === "integer") {
    return Type.Number();
  }

  if (type === "boolean") {
    return Type.Boolean();
  }

  if (type === "null") {
    return Type.Null();
  }

  return Type.Any();
}

/**
 * Convert a JSON Schema (from a Cortex/MCP tool definition) into a TypeBox
 * schema suitable for `api.registerTool({ parameters: ... })`.
 *
 * Expects the root schema to be an object type (as tool parameters always are).
 * If the root is not an object, wraps it in `Type.Object({})`.
 */
export function jsonSchemaToTypeBox(schema: JsonSchema): TSchema {
  const resolve = buildRefResolver(schema);
  const result = convertSchema(schema, resolve);
  return result;
}
