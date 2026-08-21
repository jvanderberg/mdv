const shellLanguages = new Set(["bash", "sh", "zsh", "fish", "shell", "console"]);

export function displayCodeLanguage(rawHint: string | null | undefined): string {
  const raw = rawHint?.trim().toLowerCase() ?? "";
  if (!raw) return "";
  return raw.split(/\s+/, 1)[0] ?? raw;
}

export function resolveHighlightLanguage(rawHint: string | null | undefined): string | null {
  const stripped = displayCodeLanguage(rawHint);
  if (!stripped) return null;
  const aliases: Record<string, string> = {
    golang: "go",
    h: "c",
    js: "javascript",
    javascriptreact: "javascript",
    jsx: "javascript",
    node: "javascript",
    "objective-c": "c",
    objc: "c",
    py: "python",
    python3: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    zsh: "bash",
  };
  const language = aliases[stripped] ?? stripped;
  return supportedHighlightLanguages.has(language) ? language : null;
}

export function hasShellPrompts(code: string, rawHint: string | null | undefined): boolean {
  if (!shellLanguages.has(displayCodeLanguage(rawHint))) return false;
  const lines = code.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  const prompted = lines.filter((line) => line.startsWith("$ ") || line.startsWith("# ")).length;
  return prompted * 2 >= lines.length;
}

export function stripShellPrompts(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      if (line.startsWith("$ ") || line.startsWith("# ")) return line.slice(2);
      return line;
    })
    .join("\n");
}

const supportedHighlightLanguages = new Set([
  "bash",
  "c",
  "go",
  "javascript",
  "python",
  "ruby",
  "rust",
  "toml",
  "yaml",
]);
