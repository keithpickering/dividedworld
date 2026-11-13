/**
 * The note that takes a cut's place: a real quote nested past the parser's cap (`MAX_DEPTH`, engine/bbcode/parse.ts) is not drawn, and this strip says so. It is the glass speaking
 * plainly and out of character ("The fiction may lie; the log never does"), dressed as the hidden note is (`.kb-hidden-note`, engine/ui/conduct/report.css, whose contrast is checked
 * with the glass's), and it is true whatever the cut hid: a pyramid of quotes, a quote under formatting tags, a hidden post. It carries no word of what was cut.
 */
export function CutNote() {
  return <p className="kb-glass kb-hidden-note" role="note">Quotes nested this deep are not shown.</p>;
}
