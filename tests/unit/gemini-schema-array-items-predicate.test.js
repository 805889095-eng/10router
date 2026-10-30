import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity handles array items and type predicates", () => {
  it("removes items field when type is not array (fixing: field predicate failed: $type == Type.ARRAY)", () => {
    const schema = {
      type: "object",
      properties: {
        source_paths: {
          type: "array",
          items: {
            type: [
              "null",
              "boolean",
              "object",
              "array",
              "number",
              "string"
            ],
            items: {}
          },
          description: "File paths"
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    const items = cleaned.properties.source_paths.items;

    // Items element itself must not have an "items" property unless it is an array
    expect(items.type).not.toBe("boolean");
    expect(items.type).toBe("string");
    expect(items).not.toHaveProperty("items");
  });

  it("ensures no non-array schema carries an items field", () => {
    const schema = {
      type: "object",
      properties: {
        scalar: {
          type: "string",
          items: { type: "string" }
        },
        bool: {
          type: "boolean",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.scalar).not.toHaveProperty("items");
    expect(cleaned.properties.bool).not.toHaveProperty("items");
  });

  it("ensures no non-object schema carries properties or required", () => {
    const schema = {
      type: "object",
      properties: {
        list: {
          type: "array",
          items: { type: "string" },
          properties: { foo: { type: "string" } },
          required: ["foo"]
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.list).not.toHaveProperty("properties");
    expect(cleaned.properties.list).not.toHaveProperty("required");
  });

  it("defaults empty array items to string instead of object with reason placeholder", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.tags.items.type).toBe("string");
    expect(cleaned.properties.tags.items).not.toHaveProperty("properties");
  });

  it("keeps a genuine object-typed array item intact", () => {
    const schema = {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"]
          }
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    const items = cleaned.properties.rows.items;
    expect(items.type).toBe("object");
    expect(items.properties.id.type).toBe("string");
    expect(items.required).toEqual(["id"]);
  });

  it("picks object/array from a union by structural evidence, not array order", () => {
    const withProps = cleanJSONSchemaForAntigravity(structuredClone({
      type: "object",
      properties: {
        a: { type: ["null", "boolean", "object"], properties: { x: { type: "string" } } }
      }
    }));
    expect(withProps.properties.a.type).toBe("object");

    const withItems = cleanJSONSchemaForAntigravity(structuredClone({
      type: "object",
      properties: {
        b: { type: ["null", "boolean", "array"], items: { type: "string" } }
      }
    }));
    expect(withItems.properties.b.type).toBe("array");
    expect(withItems.properties.b.items.type).toBe("string");
  });
});
