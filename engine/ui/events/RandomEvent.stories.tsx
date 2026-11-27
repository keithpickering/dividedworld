/**
 * The Random Event dialog (board 04 of docs/research/2026-11-04-cosmetics/): a found gear, a found card and a line alone, each opened over a page by a roll the
 * fake was told to make (`seed.nextEvent`) in the instance's own words. The page behind is the glass's page shell, as a board page would be under it.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Rarity } from '../../rules/cards.ts';
import { Page } from '../glass/Page.tsx';
import { cardOf, type World } from '../story.tsx';
import { RandomEvent } from './RandomEvent.tsx';

function EventPage() {
  return <Page surface="settings"><RandomEvent /></Page>;
}

const meta: Meta<typeof EventPage> = { title: 'Glass/Random Event', component: EventPage, parameters: { layout: 'fullscreen', path: '/' } };
export default meta;

type Story = StoryObj<typeof EventPage>;

/** The card the found-card roll names. */
const FOUND_CARD = '4d-chess';

/** A player with one mask, and the roll that the story names: the instance's first line of that outcome, and its first gear or the named card. */
const finds = (outcome: 'line' | 'gear' | 'card', eventRarity?: Rarity): World => (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.signInAs(me);
  const line = instance.events.lines.find((l) => l.outcome === outcome)?.key;
  const item = outcome === 'gear' ? instance.gear[0]?.key : outcome === 'card' ? cardOf(instance.cards, FOUND_CARD).key : undefined;
  fake.seed.nextEvent({ outcome, ...(item === undefined ? {} : { item }), ...(line === undefined ? {} : { line }), ...(eventRarity === undefined ? {} : { eventRarity }) });
};

/** One found gear: its art, its rarity in words, Wear it and OK. */
export const FoundGear: Story = { parameters: { world: finds('gear') } };
/** One found card: its face, its rarity in words and OK. */
export const FoundCard: Story = { parameters: { world: finds('card') } };
/** A line alone: no item, nothing given, OK. */
export const LineAlone: Story = { parameters: { world: finds('line') } };
/** A rare event giving the first gear: the bar's tag, "Rare event" with its gem, beside the item's own rarity line below. */
export const RareGear: Story = { parameters: { world: finds('gear', 'rare') } };
/** A legendary line alone: the tag at its rarest, with nothing given. */
export const LegendaryLine: Story = { parameters: { world: finds('line', 'legendary') } };
