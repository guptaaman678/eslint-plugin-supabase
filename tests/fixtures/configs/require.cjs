// A CommonJS ESLint config that require()s the plugin: tests/unit/require-stub.test.ts expects
// the run to fail with the stub's message.
const supabase = require('eslint-plugin-supabase');

module.exports = [supabase.configs.recommended];
