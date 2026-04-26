/**
 * Icon sets for the little-footer extension, with Nerd Font detection.
 */

export interface IconSet {
  pi: string;
  model: string;
  thinking: string;
  path: string;
  git: string;
  dirty: string;
  tokens: string;
  cost: string;
  context: string;
  time: string;
  separator: string;
}

const NERD_ICONS: IconSet = {
  pi: "π",
  model: "◈",
  thinking: "?",
  path: "dir",
  git: "git",
  dirty: "!",
  tokens: "tok",
  cost: "$",
  context: "◫",
  time: ">",
  separator: "|",
};

const ASCII_ICONS: IconSet = {
  pi: "π",
  model: "model",
  thinking: "think",
  path: "dir",
  git: "git",
  dirty: "*",
  tokens: "tok",
  cost: "$",
  context: "ctx",
  time: "tm",
  separator: "|",
};

/** Detect whether the terminal supports Nerd Font glyphs. */
export function detectNerdFonts(env: NodeJS.ProcessEnv = process.env): boolean {
  // Allow explicit env override
  if (env.LITTLE_FOOTER_NERD_FONTS === "1") return true;
  if (env.LITTLE_FOOTER_NERD_FONTS === "0") return false;

  const termProgram = env.TERM_PROGRAM || "";
  const term = env.TERM || "";
  const lcTerminal = env.LC_TERMINAL || "";

  // Known Nerd Font-capable terminals
  if (["iTerm.app", "WezTerm", "ghostty"].includes(termProgram)) return true;
  if (term.startsWith("xterm-kitty") || term === "alacritty" || term === "wezterm") return true;
  if (lcTerminal === "iTerm2") return true;

  return false;
}

/** Return the icon set for the given preference. */
export function iconsFor(useNerd: boolean): IconSet {
  return useNerd ? NERD_ICONS : ASCII_ICONS;
}
