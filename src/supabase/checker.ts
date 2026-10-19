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
  } catch {
    return undefined;
  }
}

/** `checkerTypeAt` for an ESTree node. */
export function typeAt(
  services: ParserServicesWithTypeInformation,
  node: TSESTree.Node,
): ts.Type | undefined {
  return checkerTypeAt(services.program.getTypeChecker(), services.esTreeNodeToTSNodeMap.get(node));
}
