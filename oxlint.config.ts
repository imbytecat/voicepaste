import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

export default defineConfig({
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  extends: [core, react, tanstack],
  ignorePatterns: [...(core.ignorePatterns ?? []), "src-tauri/target/**"],
  jsPlugins: [
    {
      name: "react-hooks-js",
      specifier: "eslint-plugin-react-hooks",
    },
    "oxlint-tailwindcss",
  ],
  options: {
    maxWarnings: 0,
    typeAware: true,
  },
  overrides: [
    {
      files: ["src/routes/**/*.tsx"],
      rules: {
        "typescript/only-throw-error": "off",
      },
    },
  ],
  rules: {
    complexity: "off",
    "func-style": "off",
    curly: "off",
    "jsx-a11y/prefer-tag-over-role": "off",
    "no-nested-ternary": "off",
    "no-empty-function": "off",
    "no-use-before-define": "off",
    "no-void": "off",
    "node/callback-return": "off",
    "promise/always-return": "off",
    "promise/catch-or-return": "off",
    "promise/no-callback-in-promise": "off",
    "promise/prefer-await-to-callbacks": "off",
    "promise/prefer-await-to-then": "off",
    "react-hooks-js/exhaustive-deps": "error",
    "react-hooks-js/rules-of-hooks": "error",
    "react/exhaustive-deps": "off",
    "react/function-component-definition": "off",
    "react/jsx-handler-names": "off",
    "react/react-compiler": "off",
    "react/rules-of-hooks": "off",
    "sort-keys": "off",
    "tailwindcss/consistent-variant-order": "error",
    "tailwindcss/enforce-canonical": "error",
    "tailwindcss/enforce-consistent-important-position": "error",
    "tailwindcss/enforce-consistent-variable-syntax": "error",
    "tailwindcss/enforce-negative-arbitrary-values": "error",
    "tailwindcss/enforce-shorthand": "error",
    "tailwindcss/no-conflicting-classes": "error",
    "tailwindcss/no-contradicting-variants": "error",
    "tailwindcss/no-deprecated-classes": "error",
    "tailwindcss/no-duplicate-classes": "error",
    "tailwindcss/no-unknown-classes": "error",
    "tailwindcss/no-unnecessary-arbitrary-value": "error",
    "tailwindcss/prefer-scale-token": "error",
    "tailwindcss/no-unnecessary-whitespace": "error",
    "typescript/no-restricted-types": "off",
    "typescript/consistent-return": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/strict-boolean-expressions": "off",
    "unicorn/no-array-for-each": "off",
    "unicorn/filename-case": "off",
    "unicorn/no-nested-ternary": "off",
  },
  settings: {
    tailwindcss: {
      entryPoint: "src/styles.css",
    },
  },
});
