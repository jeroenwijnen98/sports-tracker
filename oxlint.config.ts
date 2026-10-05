import { defineConfig } from "oxlint";
import base, { ignorePatterns } from "@jeroenwijnen98/standards/oxlint";

export default defineConfig({
  extends: [base],
  ignorePatterns: [...ignorePatterns, "src/data/**"],
});
