import { describe, expect, it } from "vitest";
import { formatMessage, translate, type MessageNamespace } from "../src/ui/i18n/index.js";

// Every namespace under ui/i18n/messages is checked; new screens are picked up automatically.
const modules = import.meta.glob<Record<string, unknown>>("../src/ui/i18n/messages/*.ts", { eager: true });

function isNamespace(value: unknown): value is MessageNamespace {
  return typeof value === "object" && value !== null && "tr" in value && "en" in value;
}

const namespaces = Object.entries(modules).flatMap(([file, exports]) =>
  Object.entries(exports)
    .filter(([, value]) => isNamespace(value))
    .map(([name, value]) => ({ id: `${file.split("/").pop()}:${name}`, messages: value as MessageNamespace })),
);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("TR/EN dictionaries", () => {
  it("discovers the message namespaces", () => {
    expect(namespaces.length).toBeGreaterThanOrEqual(4);
  });

  for (const { id, messages } of namespaces) {
    it(`${id} has identical keys, non-empty values and matching placeholders`, () => {
      expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.tr).sort());
      for (const key of Object.keys(messages.tr)) {
        const tr = messages.tr[key]!;
        const en = messages.en[key]!;
        expect(tr.trim(), `${id}.${key} tr`).not.toBe("");
        expect(en.trim(), `${id}.${key} en`).not.toBe("");
        expect(placeholders(en), `${id}.${key} placeholders`).toEqual(placeholders(tr));
      }
    });
  }

  it("formats placeholders and keeps unknown ones visible", () => {
    expect(formatMessage("{count} sipariş", { count: 3 })).toBe("3 sipariş");
    expect(formatMessage("{a} ve {b}", { a: "x" })).toBe("x ve {b}");
    const sample = { tr: { hello: "Merhaba {name}" }, en: { hello: "Hello {name}" } };
    expect(translate(sample, "en", "hello", { name: "Ayşe" })).toBe("Hello Ayşe");
    expect(translate(sample, "tr", "hello", { name: "Ayşe" })).toBe("Merhaba Ayşe");
  });
});
