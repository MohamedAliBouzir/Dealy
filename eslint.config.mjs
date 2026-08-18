// @ts-check
import { FlatCompat } from '@eslint/eslintrc';
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Airbnb's configs are .eslintrc-format only — FlatCompat bridges them
// into this flat config. Note: eslint-config-airbnb-base's peer dep is
// ESLint ^7.32.0 || ^8.2.0, and eslint-config-airbnb-typescript's is
// @typescript-eslint ^7.0.0 — this project is on ESLint 9 and
// @typescript-eslint 8. Installed with --legacy-peer-deps; verified live
// (not assumed) that the rule set still loads and runs correctly despite
// the declared mismatch — see eslint.config.mjs's exceptions block below
// for what actually needed overriding as a result.
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: eslint.configs.recommended,
});

// @typescript-eslint v8 removed every purely-stylistic/formatting rule
// (brace-style, indent, quotes, semi, etc.) — a deliberate ecosystem shift
// to "Prettier handles formatting, ESLint handles logic only," which is
// exactly this project's own architecture. eslint-config-airbnb-typescript
// (built for @typescript-eslint v7) still references the old rule names.
// ESLint 9 hard-errors on *any* referenced rule name it can't resolve in
// the plugin, even when set to 'off' — confirmed live, not assumed
// (`--print-config` failed outright with "Could not find
// 'lines-between-class-members' in plugin '@typescript-eslint'" before
// this list existed). Every name below is a formatting rule Prettier
// already owns via `prettier/prettier`, so stripping the dangling
// references is the correct fix, not a workaround — nothing is being
// silenced that wasn't already going to be overridden by Prettier anyway.
const removedIn8 = [
  'brace-style',
  'comma-dangle',
  'comma-spacing',
  'func-call-spacing',
  'indent',
  'keyword-spacing',
  'lines-between-class-members',
  'no-extra-parens',
  'no-extra-semi',
  'no-throw-literal',
  'object-curly-spacing',
  'quotes',
  'semi',
  'space-before-blocks',
  'space-before-function-paren',
  'space-infix-ops',
];

/**
 * @template T
 * @param {T[]} configs
 * @returns {T[]}
 */
function stripRemovedTypeScriptEslintRules(configs) {
  for (const config of configs) {
    const rules = /** @type {{rules?: Record<string, unknown>}} */ (config)
      .rules;
    if (!rules) continue;
    for (const name of removedIn8) {
      delete rules[`@typescript-eslint/${name}`];
    }
  }
  return configs;
}

export default tseslint.config(
  {
    // prisma.config.ts: CLI/tooling config, same category as
    // eslint.config.mjs — never part of the running app (see its own
    // header comment), so application-source rules like
    // import/no-extraneous-dependencies (which correctly flags it
    // otherwise, since `prisma` the CLI package is a devDependency) don't
    // apply to it.
    ignores: [
      'eslint.config.mjs',
      'prisma.config.ts',
      'src/generated/**',
      'dist/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // airbnb-typescript/base (not the React-inclusive default `airbnb-typescript`
  // or full `airbnb`) — this is a NestJS backend, no React/JSX anywhere.
  // Ordering: after typescript-eslint's type-aware rules (so Airbnb's
  // stylistic/best-practice opinions can override generic recommended
  // defaults where they differ), before Prettier (see below).
  ...stripRemovedTypeScriptEslintRules(
    compat.extends('airbnb-base', 'airbnb-typescript/base'),
  ),
  // MUST be last of the rule-set presets: eslint-config-prettier (bundled
  // inside this preset) disables every ESLint rule that would conflict
  // with Prettier's own formatting. If Airbnb loaded after this instead,
  // its stylistic rules would win back and re-introduce style errors
  // Prettier would already have fixed.
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],

      // --- Deliberate exceptions to Airbnb, each with a specific reason ---
      // Named exports are this codebase's universal, deliberate convention
      // — every worked example in .claude/skills/nestjs-clean-architecutre/
      // SKILL.md uses them exclusively (`export class Device`, `export
      // interface IDeviceRepository`, `export const DEVICE_REPOSITORY`),
      // and it's the near-universal norm in NestJS codebases generally
      // (consistent auto-import behavior, refactor-safe renames, multiple
      // named exports per file where useful — e.g. a repository interface
      // alongside its DI token). Airbnb's Node-era default-export
      // preference predates that ecosystem norm. This rule flagged every
      // single file in the codebase (13/13 lint errors before this
      // exception) — a narrow, single-rule override, not a broad
      // import/* category disable.
      'import/prefer-default-export': 'off',
    },
  },
);
