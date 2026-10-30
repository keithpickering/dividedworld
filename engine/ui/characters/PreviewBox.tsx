/**
 * "What everyone will see": the preview of a debut, a Turn or a reveal, drawn the way the thread
 * will draw it, as the Turn board does: the heading on the glass, then a post of the board's own,
 * black on white in its type, who posts it and when on the left, its lines on the right. Every
 * line a preview holds is The System's (previews.ts), so it is named once, as a post names its author.
 */
import type { Preview } from './previews.ts';

export function PreviewBox({ preview }: { readonly preview: Preview }) {
  const by = preview.lines[0]?.by;
  return (
    <div className="kb-preview" role="group" aria-label="What everyone will see">
      <p className="kb-preview-head" aria-hidden="true">What everyone will see</p>
      <div className="kb-preview-post">
        <p className="kb-preview-side">
          {by && <b className="kb-preview-by">{by}</b>}
          <span className="kb-preview-where">{preview.where}.</span>
        </p>
        <div className="kb-preview-lines">
          {preview.nothing !== null && <p className="kb-preview-nothing">{preview.nothing}</p>}
          {preview.lines.map((l, i) => <p key={i} className="kb-preview-line">{l.text}</p>)}
        </div>
      </div>
    </div>
  );
}
