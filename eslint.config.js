import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "playwright-report",
      "test-results",
      "supabase/functions",
      "src/lib/database.types.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "error",
    },
  },
  {
    // Respuestas HTTP de las pruebas: su forma es dinámica a propósito.
    files: ["test-support/**", "**/*.integration.test.ts", "e2e/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  { files: ["**/*.mjs"], languageOptions: { globals: globals.node } },
  { files: ["e2e/**", "*.config.ts"], languageOptions: { globals: globals.node } },
);
