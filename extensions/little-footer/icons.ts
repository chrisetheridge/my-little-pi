/**
 * ASCII icon labels for the little-footer extension.
 */

export interface IconSet {
  model: string;
  thinking: string;
  path: string;
  git: string;
  dirty: string;
  tokens: string;
  cost: string;
  time: string;
  separator: string;
}

const ICONS: IconSet = {
  model: "model",
  thinking: "think",
  path: "",
  git: "git",
  dirty: "*",
  tokens: "tok",
  cost: "",
  time: "",
  separator: "|",
};

/** Return the ASCII icon set. */
export function iconsFor(): IconSet {
  return ICONS;
}
