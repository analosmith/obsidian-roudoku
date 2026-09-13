import obsidian from "eslint-plugin-obsidianmd";
import globals from "globals";
export default [
  ...obsidian.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: [
            "Google Cloud TTS",
            "Google Cloud",
            "Google",
            "ElevenLabs",
            "OpenAI",
            "iPhone",
            "SecretStorage",
            "Obsidian",
            "API",
          ],
        },
      ],
      // The probe targets 1.11.5; searchable declarative settings require 1.13.0.
      // Keep the supported imperative SecretComponent until the minimum version changes.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
];
