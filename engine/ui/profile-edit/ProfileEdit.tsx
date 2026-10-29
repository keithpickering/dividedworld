/**
 * Profile edit, for the player's own characters only: title (up to 40 characters), signature
 * (BBCode, up to 500, with a preview drawn by the board's own renderer), pip style (the instance's
 * styles; the default alone in the slice) and the avatar. The page has one address; the character
 * is chosen in the page, from a select of the player's own, opening on the one the My characters link
 * carried in history.state, else on the HUD's. No address names a character the player plays. A
 * character still waiting to debut has no profile to edit until it has.
 */
import { useEffect, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Character, Id } from '../data/api.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useLocation } from '../router.tsx';
import { AvatarEditor } from './Cropper.tsx';
import type { PictureIo } from './crops.ts';
import './profile-edit.css';

const TITLE_MAX = 40;
const SIGNATURE_MAX = 500;

/** The character a navigation carried in history.state, if it is a string; whether it is the player's own is checked by the page. */
const carriedBy = (state: unknown): unknown => (typeof state === 'object' && state !== null ? (state as { character?: unknown }).character : undefined);

export function ProfileEdit({ io }: { readonly io?: PictureIo }) {
  const { api, instance } = useKayfa();
  const { characters, loaded, hudCharacter } = usePlayer();
  const location = useLocation();
  const signedIn = useSignedIn(api);
  const [picked, setPicked] = useState<Id | null>(null);
  useEffect(() => { setPicked(null); }, [location]);
  const own = (x: unknown): x is Id => typeof x === 'string' && characters.some((c) => c.id === x);
  const id: Id | null = [picked, carriedBy(location.state), hudCharacter?.id].find(own)
    ?? characters.find((c) => c.debutedAt !== null && c.retiredAt === null)?.id ?? characters[0]?.id ?? null;
  const mine = characters.find((c) => c.id === id) ?? null;
  const [profile, setProfile] = useState<Character | null | 'failed'>(null);
  const [title, setTitle] = useState('');
  const [signature, setSignature] = useState('');
  const [pip, setPip] = useState('default');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState('');

  const live = mine !== null && mine.debutedAt !== null && mine.retiredAt === null;
  useEffect(() => {
    setProfile(null);
    setSaved('');
    setRefusal(null);
    if (!live || id === null) return;
    let current = true;
    void api.characters([id]).then((found) => {
      if (!current) return;
      const c = found[0] ?? null;
      setProfile(c);
      if (c) { setTitle(c.title); setSignature(c.signature); setPip(c.pipStyle); }
    }, () => { if (current) setProfile('failed'); });
    return () => { current = false; };
  }, [api, id, live]);

  if (signedIn === null || (signedIn && !loaded)) return <div className="kb-profile-edit" aria-busy="true" />;
  if (!signedIn) return <div className="kb-profile-edit"><SignInPrompt /></div>;

  const back = <p><Link to="/characters">Back to your characters</Link></p>;
  if (!mine || id === null) {
    return (
      <div className="kb-profile-edit">
        <h1 className="kb-heading">Edit profile</h1>
        <p className="kb-notice">You have no characters yet, so there is no profile here for you to edit. <Link to="/characters/new">Make a character</Link> first.</p>
        {back}
      </div>
    );
  }
  const picker = (
    <label className="kb-field">
      <span>Character</span>
      <select className="kb-select" value={id} onChange={(e) => setPicked(e.target.value)}>
        {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
  /* The same head in every state, so the select keeps its place in the tree (and its open list) while a profile loads. */
  const head = (
    <>
      <p className="kb-crumb"><Link to="/">Index</Link> › <Link to="/characters">Your characters</Link> › {mine.name}</p>
      <h1 className="kb-heading">Edit {mine.name}</h1>
      {picker}
    </>
  );
  if (mine.retiredAt !== null) {
    return (
      <div className="kb-profile-edit">
        {head}
        <p className="kb-notice">{mine.name} is retired. An admin can restore it; until then its profile cannot be edited.</p>
        {back}
      </div>
    );
  }
  if (mine.debutedAt === null) {
    return (
      <div className="kb-profile-edit">
        {head}
        <p className="kb-notice">{mine.name} is waiting to debut at the next settlement. It has no profile to edit until it has debuted.</p>
        {back}
      </div>
    );
  }
  if (profile === 'failed') return <div className="kb-profile-edit">{head}<p className="kb-notice" data-kb-tone="refusal">The profile could not be loaded. Reload the page to try again.</p></div>;
  if (profile === null) return <div className="kb-profile-edit">{head}<div aria-busy="true" /></div>;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setSaved('');
    try {
      const answer = await api.setProfile(id, title, signature, pip);
      if (!answer.ok) { setRefusal(answer.error); return; }
      setProfile(answer.value);
      setSaved('Profile saved.');
    } catch {
      setRefusal('The profile could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb-profile-edit">
      {head}
      <p className="kb-muted kb-small">What you set here is public: it shows beside {mine.name}&apos;s posts.</p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="kb-field">
          <span>Title</span>
          <input className="kb-input kb-wide" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} aria-describedby="pe-title-count" />
        </label>
        <p id="pe-title-count" className="kb-small kb-muted">{[...title].length} of {TITLE_MAX}</p>
        <label className="kb-field">
          <span>Signature</span>
          <textarea className="kb-textarea" rows={4} value={signature} maxLength={SIGNATURE_MAX} onChange={(e) => setSignature(e.target.value)} aria-describedby="pe-signature-count" />
        </label>
        <p id="pe-signature-count" className="kb-small kb-muted">{[...signature].length} of {SIGNATURE_MAX}. BBCode, as in a post.</p>
        {signature.trim() && (
          <div className="kb-signature-preview" role="group" aria-label="Signature preview">
            <BbCode text={signature} />
          </div>
        )}
        <label className="kb-field">
          <span>Pip style</span>
          <select className="kb-select" value={pip} onChange={(e) => setPip(e.target.value)}>
            {instance.pipStyles.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <p><button type="submit" className="kb-button" data-kb-primary="" disabled={busy}>Save the profile</button></p>
        <div role="status">{saved && <p className="kb-notice">{saved}</p>}</div>
      </form>
      <AvatarEditor character={profile} onSaved={setProfile} io={io} />
    </div>
  );
}
