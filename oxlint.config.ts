import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    ".sandcastle/**",
    ".playwright-mcp/**",
    "src/data/**",
  ],
  rules: {
    "no-nested-ternary": "error",
    "no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    "oxc/no-accumulating-spread": "error",
  },
});
