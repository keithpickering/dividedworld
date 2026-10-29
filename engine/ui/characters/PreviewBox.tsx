/** "What everyone will see": the preview of a debut, a Turn or a reveal, as a box the way the thread will draw it. */
import type { Preview } from './previews.ts';

export function PreviewBox({ preview }: { readonly preview: Preview }) {
  return (
    <div className="kb-preview" role="group" aria-label="What everyone will see">
      <p className="kb-preview-head kb-small kb-muted" aria-hidden="true">What everyone will see</p>
      {preview.nothing !== null && <p className="kb-preview-nothing">{preview.nothing}</p>}
      {preview.lines.map((l, i) => (
        <p key={i} className="kb-preview-line">
          <span className="kb-preview-by kb-small">{l.by}</span> <span className="kb-preview-text">{l.text}</span>
        </p>
      ))}
      <p className="kb-preview-where kb-small kb-muted">{preview.where}.</p>
    </div>
  );
}
