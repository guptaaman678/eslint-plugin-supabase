'use strict';

// The package's `require` condition points here. The plugin is an ES module that loads its SQL
// parser with a top-level await (ADR-016), which `require()` cannot load, so this stub explains
// the form that works instead of Node's ERR_REQUIRE_ASYNC_MODULE.
const error = new Error(
  [
    'eslint-plugin-supabase is an ES module that loads its SQL parser with a top-level await, so it cannot be loaded with require().',
    'In a CommonJS config (eslint.config.cjs), export a Promise instead:',
    '',
    "  module.exports = import('eslint-plugin-supabase').then(({ default: supabase }) => [supabase.configs.recommended]);",
    '',
    'An ES module config (eslint.config.mjs, or eslint.config.js in a "type": "module" package) can import the plugin as usual.',
  ].join('\n'),
);
error.code = 'ERR_REQUIRE_ASYNC_MODULE';
throw error;
