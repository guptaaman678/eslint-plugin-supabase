#!/usr/bin/env node
// Runs eslint-doc-generator with the given arguments. The generator loads a plugin with require()
// first, which cannot load this plugin: its entry module has a top-level await (ADR-016). So this
// script imports the built plugin and puts it in require's cache under the entry point, where the
// generator's require() finds it.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const entry = require.resolve('../dist/index.js');
const { default: plugin } = await import(pathToFileURL(entry).href);
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: plugin,
  children: [],
  paths: [],
};

const generator = path.dirname(require.resolve('eslint-doc-generator/package.json'));
const bin = path.join(generator, 'dist', 'bin', 'eslint-doc-generator.js');
process.argv = [process.argv[0], bin, ...process.argv.slice(2)];
await import(pathToFileURL(bin).href);
