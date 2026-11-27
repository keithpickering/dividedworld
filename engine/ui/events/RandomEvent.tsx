/**
 * The Random Event dialog (the cosmetics design, section 5; board 04 of docs/research/2026-11-04-cosmetics/): on a board page's or a thread page's load, for a signed-in
 * player with a character to roll for, one chance at an event (`randomEvent`, once per page load, never per render). An answer opens the glass's modal over the page:
 * "SOMETHING HAPPENED!", the item's picture beside the instance's line, with `{item}` filled by the item's name and set apart in it, the item's rarity in plain words
 * ("Uncommon gear, now in your wardrobe."), and a foot of Wear it (a gear only: the wardrobe with the piece placed) or OK beside the lock and "No other player sees this". It names
 * no mask: the roll is taken for the character being played, but an event is the player's, and what it gives is held by all their characters (the log says which mask, as
 * it does for everything). OK is its one control for closing, so the bar is the title alone; Esc and a press on the dimmed page are the other ways out, and focus returns
 * to where it was (the modal's own).
 *
 * Nothing is asked of the player and nothing is claimed: whatever the event gave is in the wardrobe or the hand already. A roll that fails, is refused, or finds nothing
 * shows nothing at all, and never says which ("a response never proves a private fact"). This is the glass speaking, so the line is the instance's committed copy and
 * may joke about what happened; it never bluffs, and it speaks as no character. No Aura moves.
 *
 * An event rarer than common carries a tag at the end of the bar, after the title: the rarity's gem and "{Rarity} event" (the event-rarity design, section 3). It says how
 * rare the roll was, a fact the player alone is shown; the gem's shape and the word tell the rarity, never its color alone. It is the glass's own plain copy, and a common
 * event, which is most of them, shows nothing new. The item's own line below it is the item's rarity, which is a separate fact.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { RandomEvent as Event } from '../data/api.ts';
import { faceOf, gemOf, rarityName, withCardEconomy } from '../cards/faces.ts';
import { Postcard } from '../cards/Postcard.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { SecretLock } from '../glass/SecretLock.tsx';
import { usePlayer } from '../player.tsx';
import '../glass/gem.css';
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
  const gear = event.outcome === 'gear' ? instance.gear.find((g) => g.key === event.item) : undefined;
  const rules = event.outcome === 'card' ? instance.cards.find((c) => c.key === event.item) : undefined;
  /* The server gave something whenever it named an item; a key this instance does not know is still named by its key. */
  const item = gear?.name ?? rules?.name ?? event.item;
  /* The line is the instance's text, cut where {item} stands in it; a line the instance does not have is still said, plainly. */
  const words = (event.line ?? (item === null ? 'Something happened.' : 'You found {item}.')).split('{item}');
  const shipped = gear !== undefined ? ui.gear[gear.key] : undefined;
  const art = shipped?.views[shipped.default]?.art;
  const face = rules !== undefined ? faceOf(rules, ui.cards.find((c) => c.key === rules.key), withCardEconomy(instance.settings, settings.cardEconomy), ui.copy.cardKinds) : null;
  const tier = event.eventRarity;
  const pictured = art !== undefined || face !== null;
  return (
    <Overlay title="SOMETHING HAPPENED!" surface="effect" className="kb-event-overlay" closeAt="none" aside={tier === 'common' ? undefined : <p className="kb-event-rarity" data-kb-rarity={tier}><span className="kb-gem" aria-hidden="true" data-kb-rarity={tier} data-kb-gem={gemOf(tier)} />{rarityName(tier)} event</p>} data={{ 'kb-event': pictured ? 'find' : 'words' }} onClose={onClose}>
      <div className="kb-event">
        {pictured && (
          <span className="kb-event-art" aria-hidden="true">
            {art !== undefined && <img src={art} alt="" draggable={false} />}
            {face !== null && <Postcard face={face} size="slot" />}
          </span>
        )}
        <div className="kb-event-words">
          <p className="kb-event-line">
            {words.map((part, i) => <Fragment key={i}>{i > 0 && item !== null && <strong>{item}</strong>}{part}</Fragment>)}
          </p>
          {item !== null && event.rarity !== null && <p className="kb-event-found">{rarityName(event.rarity)} {event.outcome}, now in your {event.outcome === 'gear' ? 'wardrobe' : 'hand'}.</p>}
        </div>
      </div>
      <div className="kb-event-foot">
        <ButtonRow>
          {gear !== undefined && <GlassButton to="/wardrobe" kind="primary" state={{ character: event.character, wear: gear.key }} onClick={onClose}>Wear it</GlassButton>}
          <GlassButton onClick={onClose}>OK</GlassButton>
        </ButtonRow>
        <p className="kb-event-secret"><SecretLock />No other player sees this</p>
      </div>
    </Overlay>
  );
}
