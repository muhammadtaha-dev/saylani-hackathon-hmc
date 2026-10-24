import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // This app intentionally fetches data in effects (client-side session
      // gating behind server-verified APIs). Every setState happens after the
      // fetch resolves; the compiler rule flags the whole call graph anyway.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
