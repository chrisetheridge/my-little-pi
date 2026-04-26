import { afterEach, describe, expect, it } from "vitest";
import { detectNerdFonts, iconsFor } from "./icons.ts";

describe("detectNerdFonts", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns true when LITTLE_FOOTER_NERD_FONTS=1", () => {
    process.env.LITTLE_FOOTER_NERD_FONTS = "1";
    expect(detectNerdFonts()).toBe(true);
  });

  it("returns false when LITTLE_FOOTER_NERD_FONTS=0", () => {
    process.env.LITTLE_FOOTER_NERD_FONTS = "0";
    expect(detectNerdFonts()).toBe(false);
  });

  it("returns true for WezTerm TERM_PROGRAM", () => {
    const env = { TERM_PROGRAM: "WezTerm" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns true for iTerm.app TERM_PROGRAM", () => {
    const env = { TERM_PROGRAM: "iTerm.app" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns true for ghostty TERM_PROGRAM", () => {
    const env = { TERM_PROGRAM: "ghostty" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns true for xterm-kitty TERM", () => {
    const env = { TERM: "xterm-kitty" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns true for alacritty TERM", () => {
    const env = { TERM: "alacritty" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns true for wezterm TERM", () => {
    const env = { TERM: "wezterm" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns true for LC_TERMINAL=iTerm2", () => {
    const env = { LC_TERMINAL: "iTerm2" };
    expect(detectNerdFonts(env)).toBe(true);
  });

  it("returns false for plain env", () => {
    const env = { TERM: "xterm-256color" };
    expect(detectNerdFonts(env)).toBe(false);
  });

  it("env override takes precedence over detection", () => {
    const env = {
      TERM_PROGRAM: "WezTerm",
      LITTLE_FOOTER_NERD_FONTS: "0",
    };
    expect(detectNerdFonts(env)).toBe(false);
  });
});

describe("iconsFor", () => {
  it("returns all required keys for true (nerd)", () => {
    const icons = iconsFor(true);
    const keys = Object.keys(icons);
    const expectedKeys = [
      "pi",
      "model",
      "thinking",
      "path",
      "git",
      "tokens",
      "cost",
      "context",
      "separator",
    ];
    for (const key of expectedKeys) {
      expect(keys).toContain(key);
      expect(typeof icons[key as keyof typeof icons]).toBe("string");
    }
  });

  it("returns all required keys for false (ascii)", () => {
    const icons = iconsFor(false);
    const keys = Object.keys(icons);
    const expectedKeys = [
      "pi",
      "model",
      "thinking",
      "path",
      "git",
      "tokens",
      "cost",
      "context",
      "separator",
    ];
    for (const key of expectedKeys) {
      expect(keys).toContain(key);
      expect(typeof icons[key as keyof typeof icons]).toBe("string");
    }
  });

  it("ascii model icon is 'model' not a glyph", () => {
    const ascii = iconsFor(false);
    expect(ascii.model).toBe("model");
  });

  it("nerd model icon is a glyph", () => {
    const nerd = iconsFor(true);
    expect(nerd.model).not.toBe("model");
  });
});
