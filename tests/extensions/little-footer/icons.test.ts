import { describe, expect, it } from "vitest";
import { iconsFor } from "../../../extensions/little-footer/icons.ts";

describe("iconsFor", () => {
  it("returns all required keys", () => {
    const icons = iconsFor();
    const keys = Object.keys(icons);
    const expectedKeys = [
      "model",
      "thinking",
      "path",
      "git",
      "dirty",
      "tokens",
      "cost",
      "context",
      "time",
      "separator",
    ];
    for (const key of expectedKeys) {
      expect(keys).toContain(key);
      expect(typeof icons[key as keyof typeof icons]).toBe("string");
    }
  });

  it("uses only ASCII labels and markers", () => {
    const icons = iconsFor();
    expect(icons).toEqual({
      model: "model",
      thinking: "think",
      path: "",
      git: "git",
      dirty: "*",
      tokens: "tok",
      cost: "",
      time: "",
      separator: "|",
    });
    for (const icon of Object.values(icons)) {
      expect(/^[\x00-\x7F]*$/.test(icon)).toBe(true);
    }
  });
});
