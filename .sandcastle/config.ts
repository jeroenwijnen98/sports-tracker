import type { SandcastleConfig } from "@jeroenwijnen98/standards/sandcastle";

export default {
  image: { node: "26" },
  install: [{ command: "npm ci --no-audit --no-fund", when: ["package.json", "package-lock.json"] }],
} satisfies SandcastleConfig;
