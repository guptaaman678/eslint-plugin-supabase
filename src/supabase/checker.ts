import type { ParserServicesWithTypeInformation, TSESTree } from '@typescript-eslint/utils';
import type ts from 'typescript';

/**
 * The checker's type for a node, or undefined when the checker throws while computing it.
 * TypeScript can throw inside its own code for one expression: 6.0.3 does, in its
 * module-specifier code, when its host reports no current directory. That expression is then
 * skipped like one of unknown type (§6.1), instead of stopping the lint of the whole file.
 */
export function checkerTypeAt(checker: ts.TypeChecker, node: ts.Node): ts.Type | undefined {
  try {
    return checker.getTypeAtLocation(node);
  } catch (error) {
    if (process.env.CORPUS_DIAG) diag(error, node);
    return undefined;
  }
}

// Diagnostic only (branch agent/T9.5-corpus-diag, never merged): the first throws' stacks, with
// paths reduced to the package and file name, and the throw count at exit.
let throws = 0;
function diag(error: unknown, node: ts.Node): void {
  throws++;
  if (throws === 1) {
    process.on('exit', () => process.stderr.write(`DIAG throws ${throws}\n`));
  }
  if (throws > 2) return;
  const lines = String((error as Error).stack ?? error)
    .split('\n')
    .slice(0, 40)
    .map((line) => line.replace(/\(?\/[^\s)]*\/(node_modules\/[^/]+|dist)\/[^\s)]*\/?([^/\s)]+)\)?/g, '[$1 $2]'));
  process.stderr.write(`DIAG kind ${node.kind}\n${lines.join('\n')}\n`);
}

/** `checkerTypeAt` for an ESTree node. */
export function typeAt(
  services: ParserServicesWithTypeInformation,
  node: TSESTree.Node,
): ts.Type | undefined {
  const type = checkerTypeAt(
    services.program.getTypeChecker(),
    services.esTreeNodeToTSNodeMap.get(node),
  );
  if (type === undefined && process.env.CORPUS_DIAG && !programShown) {
    programShown = true;
    const options = services.program.getCompilerOptions();
    process.stderr.write(
      `DIAG program cwd ${JSON.stringify(services.program.getCurrentDirectory())} config ${JSON.stringify(options.configFilePath)} baseUrl ${JSON.stringify(options.baseUrl)} paths ${options.paths ? 'set' : 'unset'} moduleResolution ${String(options.moduleResolution)}\n`,
    );
  }
  return type;
}
let programShown = false;
