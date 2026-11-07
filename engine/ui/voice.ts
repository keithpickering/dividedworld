/**
 * Who speaks, held by a scan (the board look design, section 7): the engine names no one. Every string a player reads in
 * `engine/ui/` says the role, the staff or the game by the instance's `UiCopy` (roleWord, staffWord, gameWord, staffBoardTag)
 * or by the board's own data, so "The System" appears nowhere in a string literal, template or JSX text of a screen. Admin
 * screens (`admin/`) keep the machine's name, being about the machine, and tests are tests. Comments are not strings and are
 * not read. Pure, so the self-test can plant a defect.
 */
import ts from 'typescript';

/** The strings in a source file that name The System, each with its line; comments are skipped because only string-bearing nodes are read. */
export function systemStrings(file: string, source: string): { readonly line: number; readonly text: string }[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
        ? node.text
        : null;
    if (text !== null && /\b(?:[Tt]he System|THE SYSTEM)\b/u.test(text.replace(/\s+/gu, ' '))) {
      found.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, text: text.trim().slice(0, 80) });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}
