/**
 * The avatar cropper: one picture, two frames. The player picks a picture (a file input; it is
 * never uploaded as it is), and a portrait frame (from square to twice as tall as wide) and a
 * square frame inside it appear, the square at the portrait's top where a face usually is. Each
 * frame moves and resizes by pointer drag and by keyboard (arrows move, plus and minus resize; the
 * portrait's shape has buttons), with frames held as fractions of the picture they are cut from. On
 * Save each crop is drawn to a canvas and re-encoded as a WebP (crops.ts), so nothing but pixels is
 * sent; a file that would carry anything else is refused here. A recrop of the square alone cuts it
 * from the stored portrait, loaded from its public address, and sends only the square.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { Character, Frame } from '../data/api.ts';
import { cutAvatar, type Picture, type PictureIo } from './crops.ts';
import { composeFrames, defaultPortrait, defaultSquare, framePixels, moveFrame, portraitProblem, reshapeSquare, scaleFrame, stretchFrame, tallness } from './frames.ts';
import { browserIo } from './picture.ts';

type Cutting =
  | { readonly kind: 'new'; readonly picture: Picture; readonly portrait: Frame; readonly square: Frame }
  | { readonly kind: 'recrop'; readonly picture: Picture; readonly square: Frame };

export interface AvatarEditorProps {
  readonly character: Character;
  readonly onSaved: (character: Character) => void;
  /** The browser's pieces, replaceable in a test (jsdom has no canvas). */
  readonly io?: PictureIo;
}

const STEP = 0.01;
const SCALE = 1.05;
const SHAPE = 0.02;

const words = (error: unknown) => (error instanceof Error && error.message ? error.message : 'That could not be done. Try again.');

interface FrameBoxProps {
  readonly label: string;
  readonly tone: 'portrait' | 'square';
  /** Where it sits on the picture, in fractions of the picture. */
  readonly place: Frame;
  readonly help: string;
  readonly onMove: (dx: number, dy: number) => void;
  readonly onScale: (factor: number) => void;
  /** Dragging the corner: a change of size, in fractions of the picture. */
  readonly onCorner: (dw: number, dh: number) => void;
}

function FrameBox({ label, tone, place, help, onMove, onScale, onCorner }: FrameBoxProps) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const mode = useRef<'move' | 'corner'>('move');
  const key = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-STEP * big, 0], ArrowRight: [STEP * big, 0], ArrowUp: [0, -STEP * big], ArrowDown: [0, STEP * big] };
    const m = moves[e.key];
    if (m) { e.preventDefault(); onMove(m[0], m[1]); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); onScale(SCALE); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); onScale(1 / SCALE); }
  };
  const down = (e: PointerEvent<HTMLElement>, how: 'move' | 'corner') => {
    e.preventDefault();
    e.stopPropagation();
    mode.current = how;
    last.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const drag = (e: PointerEvent<HTMLElement>) => {
    const from = last.current;
    const stage = e.currentTarget.closest('.kb-crop-stage');
    if (!from || !stage) return;
    const r = stage.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const [dx, dy] = [(e.clientX - from.x) / r.width, (e.clientY - from.y) / r.height];
    last.current = { x: e.clientX, y: e.clientY };
    if (mode.current === 'move') onMove(dx, dy);
    else onCorner(dx, dy);
  };
  const up = () => { last.current = null; };
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-description={help}
      className="kb-crop-frame"
      data-kb-frame={tone}
      style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%`, width: `${place.w * 100}%`, height: `${place.h * 100}%` }}
      onKeyDown={key}
      onPointerDown={(e) => down(e, 'move')}
      onPointerMove={drag}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="kb-crop-corner" aria-hidden="true" onPointerDown={(e) => down(e, 'corner')} onPointerMove={drag} onPointerUp={up} onPointerCancel={up} />
    </div>
  );
}

export function AvatarEditor({ character, onSaved, io = browserIo }: AvatarEditorProps) {
  const { api } = useKayfa();
  const [cutting, setCutting] = useState<Cutting | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const helpId = useId();
  const current = useRef<Cutting | null>(null);
  current.current = cutting;
  useEffect(() => () => current.current?.picture.release(), []);

  const replace = (next: Cutting | null) => {
    current.current?.picture.release();
    setCutting(next);
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setSaved('');
    try {
      const picture = await io.loadFile(file);
      const portrait = defaultPortrait(picture);
      replace({ kind: 'new', picture, portrait, square: defaultSquare(framePixels(portrait, picture)) });
    } catch (error) {
      setProblem(words(error));
    }
  };

  const recrop = async () => {
    if (!character.avatarPortrait) return;
    setProblem(null);
    setSaved('');
    try {
      const picture = await io.loadUrl(character.avatarPortrait);
      replace({ kind: 'recrop', picture, square: character.squareFrame ?? defaultSquare(picture) });
    } catch (error) {
      setProblem(words(error));
    }
  };

  const update = (fn: (c: Cutting) => Cutting) => setCutting((c) => (c ? fn(c) : c));

  /* The portrait changes shape or place; the square stays square, inside it. */
  const withPortrait = (c: Cutting & { kind: 'new' }, portrait: Frame): Cutting => ({ ...c, portrait, square: reshapeSquare(c.square, framePixels(portrait, c.picture)) });
  const movePortrait = (dx: number, dy: number) => update((c) => (c.kind === 'new' ? withPortrait(c, moveFrame(c.portrait, dx, dy)) : c));
  const scalePortrait = (k: number) => update((c) => (c.kind === 'new' ? withPortrait(c, scaleFrame(c.portrait, k)) : c));
  const shapePortrait = (dw: number, dh: number) => update((c) => (c.kind === 'new' ? withPortrait(c, stretchFrame(c.portrait, dw, dh)) : c));
  /* The square's frame is in the portrait: a move on the picture is a smaller move in the portrait. */
  const unit = (c: Cutting) => (c.kind === 'new' ? { w: c.portrait.w, h: c.portrait.h } : { w: 1, h: 1 });
  const moveSquare = (dx: number, dy: number) => update((c) => ({ ...c, square: moveFrame(c.square, dx / unit(c).w, dy / unit(c).h) }));
  const scaleSquare = (k: number) => update((c) => ({ ...c, square: scaleFrame(c.square, k) }));
  const cornerSquare = (dw: number) => update((c) => ({ ...c, square: scaleFrame(c.square, 1 + dw / (unit(c).w * c.square.w)) }));

  const shapeProblem = cutting?.kind === 'new' ? portraitProblem(cutting.portrait, cutting.picture) : null;

  const save = async () => {
    if (!cutting || busy || shapeProblem) return;
    setBusy(true);
    setProblem(null);
    try {
      const frames = { portrait: cutting.kind === 'new' ? cutting.portrait : null, square: cutting.square };
      const files = await cutAvatar(io, cutting.picture, frames);
      const answer = await api.setAvatar({ character: character.id, square: files.square, portrait: files.portrait, squareFrame: frames.square, portraitFrame: frames.portrait });
      if (!answer.ok) { setProblem(answer.error); return; }
      replace(null);
      setSaved('Avatar saved.');
      onSaved(answer.value);
    } catch (error) {
      setProblem(words(error));
    } finally {
      setBusy(false);
    }
  };

  const portraitPixels = cutting?.kind === 'new' ? framePixels(cutting.portrait, cutting.picture) : null;
  const squarePlace = cutting ? (cutting.kind === 'new' ? composeFrames(cutting.portrait, cutting.square) : cutting.square) : null;

  return (
    <section className="kb-avatar-editor" aria-labelledby={`${helpId}-head`}>
      <h2 id={`${helpId}-head`} className="kb-heading">Avatar</h2>
      <p className="kb-small kb-muted">
        Choose one picture. It is cut in your browser and only the two crops are sent, as plain pictures with nothing else in them; the original stays with you.
        The portrait is shown beside your posts on a wide screen; the square is shown in lists and on a phone.
      </p>
      <label className="kb-field">
        <span>Choose a picture</span>
        <input className="kb-input kb-wide" type="file" accept="image/*" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {character.avatarPortrait && (
        <p><button type="button" className="kb-button" onClick={() => void recrop()}>Recrop the square from my stored portrait</button></p>
      )}

      {cutting && squarePlace && (
        <div className="kb-crop">
          <div className="kb-crop-stage" style={{ ['--kb-aspect' as string]: `${cutting.picture.width} / ${cutting.picture.height}`, aspectRatio: `${cutting.picture.width} / ${cutting.picture.height}` }}>
            <img src={cutting.picture.url} alt="" draggable={false} />
            {cutting.kind === 'new' && (
              <FrameBox
                label="Portrait frame" tone="portrait" place={cutting.portrait}
                help="Arrow keys move it, plus and minus resize it. The buttons below change its shape."
                onMove={movePortrait} onScale={scalePortrait} onCorner={shapePortrait}
              />
            )}
            <FrameBox
              label="Square frame" tone="square" place={squarePlace}
              help="Arrow keys move it, plus and minus resize it."
              onMove={moveSquare} onScale={scaleSquare} onCorner={cornerSquare}
            />
          </div>
          <div className="kb-crop-side">
            <p className="kb-legend kb-small"><span className="kb-crop-key" data-kb-frame="portrait" aria-hidden="true" /> Portrait, up to twice as tall as wide. <span className="kb-crop-key" data-kb-frame="square" aria-hidden="true" /> Square, cut from inside the portrait.</p>
            {portraitPixels && cutting.kind === 'new' && (
              <p className="kb-small">
                Portrait: {Math.round(portraitPixels.width)} by {Math.round(portraitPixels.height)} pixels, {tallness(cutting.portrait, cutting.picture).toFixed(2)} times as tall as wide.
              </p>
            )}
            {cutting.kind === 'new' && (
              <div className="kb-crop-shape" role="group" aria-label="Portrait shape">
                <button type="button" className="kb-button" onClick={() => shapePortrait(0, SHAPE)}>Make the portrait taller</button>
                <button type="button" className="kb-button" onClick={() => shapePortrait(0, -SHAPE)}>Make the portrait shorter</button>
                <button type="button" className="kb-button" onClick={() => shapePortrait(SHAPE, 0)}>Make the portrait wider</button>
                <button type="button" className="kb-button" onClick={() => shapePortrait(-SHAPE, 0)}>Make the portrait narrower</button>
              </div>
            )}
            <div className="kb-crop-previews" aria-hidden="true">
              <Preview picture={cutting.picture} frame={cutting.kind === 'new' ? cutting.portrait : { x: 0, y: 0, w: 1, h: 1 }} className="kb-crop-preview-portrait" aspect={cutting.kind === 'new' ? Math.min(2, Math.max(1, tallness(cutting.portrait, cutting.picture))) : cutting.picture.height / cutting.picture.width} />
              <Preview picture={cutting.picture} frame={squarePlace} className="kb-crop-preview-square" aspect={1} />
            </div>
            {shapeProblem && <p role="alert" className="kb-notice" data-kb-tone="refusal">{shapeProblem}</p>}
          </div>
        </div>
      )}
      {problem && <p role="alert" className="kb-notice" data-kb-tone="refusal">{problem}</p>}
      {cutting && (
        <p className="kb-dialog-actions">
          <button type="button" className="kb-button" onClick={() => replace(null)}>Cancel</button>
          <button type="button" className="kb-button" data-kb-primary="" disabled={busy || shapeProblem !== null} onClick={() => void save()}>
            {cutting.kind === 'new' ? 'Save the avatar' : 'Save the new square'}
          </button>
        </p>
      )}
      <div role="status">{saved && <p className="kb-notice">{saved}</p>}</div>
    </section>
  );
}

/** A box showing the part of the picture a frame cuts, by background position. */
function Preview({ picture, frame, className, aspect }: { readonly picture: Picture; readonly frame: Frame; readonly className: string; readonly aspect: number }) {
  const x = frame.w >= 1 ? 0 : (frame.x / (1 - frame.w)) * 100;
  const y = frame.h >= 1 ? 0 : (frame.y / (1 - frame.h)) * 100;
  return (
    <span
      className={`kb-crop-preview ${className}`}
      style={{ aspectRatio: `1 / ${aspect}`, backgroundImage: `url("${picture.url}")`, backgroundSize: `${100 / frame.w}% ${100 / frame.h}%`, backgroundPosition: `${x}% ${y}%` }}
    />
  );
}
