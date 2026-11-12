/**
 * The Random Event dialog (the cosmetics design, section 5; board 04 of docs/research/2026-11-04-cosmetics/): on a board page's or a thread page's load, for a signed-in
 * player with a character to roll for, one chance at an event (`randomEvent`, once per page load, never per render). An answer opens the glass's modal over the page:
 * "SOMETHING HAPPENED!", the instance's line with `{item}` filled by the item's name, the item's picture and its rarity in plain words ("uncommon gear", "rare card"),
 * "It happened to <mask>. Only you see this.", and Wear it (a gear only: the wardrobe on that mask with the piece placed) or OK. Esc and the modal's Close are the other
 * ways out, and focus returns to where it was (the modal's own).
 *
 * Nothing is asked of the player and nothing is claimed: whatever the event gave is in the wardrobe or the hand already. A roll that fails, is refused, or finds nothing
 * shows nothing at all, and never says which ("a response never proves a private fact"). This is the glass speaking, so the line is the instance's committed copy and
 * may joke about what happened; it never bluffs, and it speaks as no character. No Aura moves.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { RandomEvent as Event } from '../data/api.ts';
import { faceOf, withCardEconomy } from '../cards/faces.ts';
import { Postcard } from '../cards/Postcard.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { usePlayer } from '../player.tsx';
import './events.css';

export function RandomEvent() {
  const { api } = useKayfa();
  const player = usePlayer();
  const [event, setEvent] = useState<Event | null>(null);
  const signedIn = player.session.signedIn;
  const rollFor = player.hudCharacter !== null && player.actingCharacters.some((c) => c.id === player.hudCharacter!.id) ? player.hudCharacter.id : null;
  /* The page load's one roll: taken the first time there is somebody to roll for, and never again while this page stays. */
  const rolled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (rolled.current || !signedIn || rollFor === null) return;
    rolled.current = true;
    void (async () => {
      try {
        const answer = await api.randomEvent(rollFor);
        /* An event with no words and no item has nothing to say, so it opens nothing. */
        if (mounted.current && answer.ok && answer.value !== null && (answer.value.line !== null || answer.value.item !== null)) setEvent(answer.value);
      } catch {
        /* A failed roll is no event, and says nothing. */
      }
    })();
  }, [api, signedIn, rollFor]);
  if (event === null) return null;
  return <Dialog event={event} onClose={() => setEvent(null)} />;
}

function Dialog({ event, onClose }: { readonly event: Event; readonly onClose: () => void }) {
  const { instance, settings, ui } = useKayfa();
  const { characters } = usePlayer();
  const gear = event.outcome === 'gear' ? instance.gear.find((g) => g.key === event.item) : undefined;
  const rules = event.outcome === 'card' ? instance.cards.find((c) => c.key === event.item) : undefined;
  /* The server gave something whenever it named an item; a key this instance does not know is still named by its key. */
  const item = gear?.name ?? rules?.name ?? event.item;
  /* The line is the instance's text with {item} still in it; a line the instance does not have is still said, plainly. */
  const line = (event.line ?? (item === null ? 'Something happened.' : `You found {item}.`)).replaceAll('{item}', item ?? '');
  const mask = characters.find((c) => c.id === event.character)?.name ?? 'your character';
  const art = gear !== undefined ? ui.gear[gear.key]?.art : undefined;
  const face = rules !== undefined ? faceOf(rules, ui.cards.find((c) => c.key === rules.key), withCardEconomy(instance.settings, settings.cardEconomy), ui.copy.cardKinds) : null;
  return (
    <Overlay title="SOMETHING HAPPENED!" surface="effect" className="kb-event-overlay" onClose={onClose}>
      <div className="kb-event">
        {(art !== undefined || face !== null) && (
          <span className="kb-event-art" aria-hidden="true">
            {art !== undefined && <img src={art} alt="" draggable={false} />}
            {face !== null && <Postcard face={face} size="slot" />}
          </span>
        )}
        <div className="kb-event-words">
          <p className="kb-event-line">{line}</p>
          {item !== null && event.rarity !== null && <p className="kb-small">{event.rarity} {event.outcome}, now in your {event.outcome === 'gear' ? 'wardrobe' : 'hand'}.</p>}
          {item === null && <p className="kb-small kb-muted">Nothing was given. Most events are only this.</p>}
          <p className="kb-small kb-muted">It happened to {mask}. Only you see this.</p>
        </div>
      </div>
      <ButtonRow>
        {gear !== undefined && <GlassButton to="/wardrobe" kind="primary" state={{ character: event.character, wear: gear.key }} onClick={onClose}>Wear it</GlassButton>}
        <GlassButton onClick={onClose}>OK</GlassButton>
      </ButtonRow>
    </Overlay>
  );
}
