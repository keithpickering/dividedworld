/**
 * Divided World's rehearsal corpus (docs/plans/2026-11-11-system-rehearsal-design.md, section 3): invented regulars of a
 * Mario fangame and Minus World forum, the openers they start threads with, and the lines they answer each other in.
 * Every sketch is an invented person; no handle here belongs to a real member, so a rehearsal never puts words in a
 * real friend's mouth. Drafted once and edited by the owner in review, so each line sits on its own source line.
 *
 * A reply line may hold `{name}` (the character replied to), `{interest}` (one of the poster's) and `{board}`.
 */
import type { RehearsalCorpus, Sketch } from '../../../engine/rehearsal/types.ts';
import { wheelhouse } from '../system/wheelhouse.ts';

/** A wheelhouse entry by a word it holds; throws if none or several do, so a reordered or reworded wheelhouse cannot silently rename a topic. */
const topic = (word: string): string => {
  const found = wheelhouse.filter((w) => w.includes(word));
  if (found.length !== 1) throw new Error(`the wheelhouse has ${found.length} entries holding "${word}"`);
  return found[0]!;
};

const FANGAMES = topic('Mario fangames');
const GAMEMAKING = topic('game making');
const RETRO = topic('retro games');
const NINTENDO = topic('Nintendo');
const MINUS = topic('Minus World');
const SPEEDRUN = topic('speedrunning');
const MUSIC = topic('chiptunes');
const FORUMS = topic('forums');
const UNFINISHED = topic('never finished');

const sk = (key: string, name: string, classKey: string, voice: string, interests: readonly string[], feuds: readonly string[], least: number, most: number): Sketch =>
  ({ key, name, classKey, voice, interests, feuds, postsPerDay: { least, most } });

const sketches: readonly Sketch[] = [
  sk('mothwire', 'Mothwire', 'face', 'Warm and encouraging, signs off every post with a tiny pep talk.', [FANGAMES, GAMEMAKING, UNFINISHED], ['gravelbyte'], 1, 5),
  sk('gravelbyte', 'Gravelbyte', 'heel', 'Gruff and certain, treats every opinion he did not have first as a mistake.', [SPEEDRUN, RETRO, NINTENDO], ['mothwire', 'quillfern'], 1, 5),
  sk('tanukibrine', 'Tanukibrine', 'technician', 'Precise and a little pedantic, cites frame counts and sprite sheet dimensions.', [GAMEMAKING, FANGAMES, MUSIC], ['sodapop_rex'], 0, 3),
  sk('hexlantern', 'Hexlantern', 'lurker', 'Posts rarely, always one dry sentence, never explains the joke.', [MINUS, RETRO, FORUMS], [], 0, 1),
  sk('plumber_wick', 'Plumber Wick', 'jabroni', 'Loud, excitable and wrong about half the time, and cheerful about it.', [NINTENDO, FANGAMES, RETRO], ['quillfern'], 2, 6),
  sk('quillfern', 'Quillfern', 'tweener', 'Thoughtful reviewer who scores everything out of ten and defends the decimals.', [FANGAMES, GAMEMAKING, MUSIC, UNFINISHED], ['gravelbyte', 'plumber_wick'], 1, 4),
  sk('sodapop_rex', 'Sodapop Rex', 'heel', 'Contrarian by trade, opens with "actually" and means it.', [NINTENDO, RETRO, FORUMS], ['tanukibrine', 'mothwire'], 1, 5),
  sk('dingleberry_ox', 'Dingleberry Ox', 'jabroni', 'Posts in all lowercase with too many exclamation marks and no regrets.', [FANGAMES, MUSIC, FORUMS], [], 2, 6),
  sk('pocketcrane', 'Pocketcrane', 'face', 'Newcomer, polite to a fault, asks a question in every post.', [FANGAMES, GAMEMAKING, NINTENDO], [], 1, 4),
  sk('stratocumulo', 'Stratocumulo', 'tweener', 'Dreamy, drifts off topic into half-remembered games from childhood.', [RETRO, MUSIC, UNFINISHED], ['bolthole'], 0, 3),
  sk('bolthole', 'Bolthole', 'technician', 'Speedrunner who talks in splits and route changes and nothing else.', [SPEEDRUN, MINUS, RETRO], ['stratocumulo'], 1, 4),
  sk('crumpetmoon', 'Crumpetmoon', 'face', 'Spriter who shares work in progress and thanks everyone twice.', [GAMEMAKING, FANGAMES, FORUMS], [], 1, 4),
  sk('ironpudding', 'Ironpudding', 'heel', 'Dry, cutting and always right about level design, which is the worst part.', [GAMEMAKING, FANGAMES, UNFINISHED], ['crumpetmoon'], 1, 3),
  sk('waffleknight', 'Waffleknight', 'jabroni', 'Overconfident romhacker who announces a release date every week.', [GAMEMAKING, UNFINISHED, FANGAMES], ['ironpudding'], 2, 5),
  sk('lanternfish_97', 'Lanternfish 97', 'lurker', 'Long silences, then a single devastating bit of trivia.', [MINUS, RETRO, FORUMS, NINTENDO], [], 0, 1),
  sk('barnacle_jim', 'Barnacle Jim', 'tweener', 'Nostalgic forum veteran who remembers when signatures had a size limit.', [FORUMS, RETRO, MUSIC], ['dingleberry_ox'], 1, 4),
  sk('zephyrgoat', 'Zephyrgoat', 'technician', 'Glitch hunter who writes tidy step-by-step posts nobody asked for and everybody saves.', [MINUS, SPEEDRUN, GAMEMAKING, RETRO], [], 1, 3),
  sk('marmaladedrift', 'Marmaladedrift', 'face', 'Chiptune composer who answers every thread with a tune recommendation.', [MUSIC, RETRO, FANGAMES], [], 1, 4),
  sk('cobaltpretzel', 'Cobaltpretzel', 'heel', 'Hot takes served cold; says the beloved game is overrated and waits.', [NINTENDO, FANGAMES, RETRO], ['marmaladedrift', 'mothwire'], 1, 5),
  sk('nimbus_oat', 'Nimbus Oat', 'lurker', 'Reads everything, posts a short agreeing line once a week.', [FORUMS, FANGAMES, MUSIC], [], 0, 1),
  sk('rustpuddle', 'Rustpuddle', 'jabroni', 'Chaotic, posts a screenshot with no context and the word "behold".', [MINUS, FANGAMES, UNFINISHED], ['hexlantern'], 2, 6),
  sk('velveteen_kip', 'Velveteen Kip', 'tweener', 'Earnest level designer who rewrites his own opinions mid-thread.', [GAMEMAKING, FANGAMES, SPEEDRUN], ['ironpudding'], 1, 4),
  sk('glimmerjaw', 'Glimmerjaw', 'technician', 'Engine nerd who answers a joke with a changelog.', [GAMEMAKING, RETRO, NINTENDO, MUSIC], ['plumber_wick'], 0, 3),
  sk('toadstool_annie', 'Toadstool Annie', 'face', 'Community organizer, runs the monthly contest and nags kindly about deadlines.', [FANGAMES, GAMEMAKING, FORUMS], ['sodapop_rex'], 1, 4),
  sk('cinderblock', 'Cinderblock', 'heel', 'Speedrun purist who thinks glitchless is the only honest category.', [SPEEDRUN, NINTENDO, RETRO], ['zephyrgoat'], 1, 4),
  sk('sleepyfig', 'Sleepyfig', 'lurker', 'Appears at night, posts a wistful line about a game nobody finished.', [UNFINISHED, MINUS, RETRO], [], 0, 2),
  sk('copperwhistle', 'Copperwhistle', 'tweener', 'Reviewer of tiny games, generous with praise and stingy with scores.', [FANGAMES, UNFINISHED, GAMEMAKING, MUSIC], ['quillfern'], 1, 3),
  sk('puddingbandit', 'Puddingbandit', 'jabroni', 'Joker whose bits run three posts too long.', [FORUMS, NINTENDO, FANGAMES], ['barnacle_jim'], 2, 5),
  sk('anchorite_moss', 'Anchorite Moss', 'technician', 'Quiet pixel artist, posts palettes and nothing else for weeks.', [GAMEMAKING, FORUMS, MUSIC], [], 0, 2),
  sk('frostbitten_ned', 'Frostbitten Ned', 'heel', 'Sarcastic old-timer, insists the forum peaked before he joined it.', [FORUMS, RETRO, MINUS], ['pocketcrane', 'dingleberry_ox'], 1, 4),
];

const openers: RehearsalCorpus['openers'] = {
  general: [
    { title: 'What was the first fangame you finished?', body: 'Mine took me two years and the last level is just a long hallway. I am still proud of it. What about you?' },
    { title: 'Unpopular opinion: the Nintendo water levels were fine', body: 'There, I said it. The physics were floaty on purpose and you all know it. Fight me.' },
    { title: 'Anyone else still keep a signature?', body: 'I tweaked mine again last night. It is 400 pixels wide and I regret nothing.' },
    { title: 'Minus World: place or myth?', body: 'Walk me through why it exists, and please do not tell me it is just a glitch. It feels like a place.' },
    { title: 'Help me pick a name for my hack', body: 'It is a level pack with too many pipes. So far I have "Pipe Dreams" and "Pipe Dreams 2: More Pipes". Be honest.' },
    { title: 'Share your best unfinished project', body: 'Not the shipped ones. The folder that is still on your drive and you cannot delete. I will go first: a platformer with no ending.' },
    { title: 'Chiptune of the week', body: 'Found a track that sounds like a castle in a dream. Post yours and we will build a playlist for the whole forum.' },
    { title: 'Speedrun routes: do you care about the tricks or the time?', body: 'I watch runs for the tricks and skip the numbers. Am I watching it wrong?' },
    { title: 'Rate my sprite, be kind', body: 'Sixteen by sixteen, four colors, took all evening. The hat is the hard part.' },
    { title: 'Remember when everyone had a custom avatar?', body: 'Now it is all the same circle. Show me your oldest avatar and I will show you mine.' },
  ],
  'video-games': [
    { title: 'What are you playing this week?', body: 'I am forty hours into a farming game and I have not farmed once. Fishing only. Your turn.' },
    { title: 'Best final boss of all time', body: 'It has to be fun to fight, not just hard. Make your case in one paragraph.' },
    { title: 'A game you defend that everyone hates', body: 'Mine has a camera that fights you, and I love it anyway. Who is with me?' },
    { title: 'Stuck on a puzzle, no spoilers please', body: 'There is a room with four statues and a door. I have pushed every statue. Hints only, nothing more.' },
    { title: 'Handheld or console?', body: 'I play everything in bed now. Tell me what you play on, and why yours is wrong.' },
  ],
  'movies-tv': [
    { title: 'What did you watch last night?', body: 'I put on a documentary about bridges and stayed up until two. No regrets.' },
    { title: 'Sequels better than the original', body: 'Give me one, and the scene that proves it. Keep the spoilers marked.' },
    { title: 'The show you quit after one episode', body: 'Everyone said it gets good in season two. I am not waiting that long. What did you drop?' },
    { title: 'Best video game movie, honestly', body: 'The bar is on the floor and that is the fun of it. Rank the ones you have seen.' },
    { title: 'Comfort rewatch thread', body: 'The thing you put on when you are sick or sad. Mine is a cooking show from before I was born.' },
  ],
  'art-showcase': [
    { title: 'Sprite WIP, feedback wanted', body: 'A walking cycle in six frames. The arms feel stiff and I cannot tell why. Be honest.' },
    { title: 'Palette swap challenge', body: 'Take your favorite sprite and give it four colors only. Post the before and the after.' },
    { title: 'Drew the staff, sorry in advance', body: 'Quick doodles of every Mod Bot I have met so far. Nobody looks like their badge.' },
    { title: 'Show your oldest art next to your newest', body: 'I will go first, and it is humbling. Everyone gets a pat on the back.' },
    { title: 'Tiny tileset, free to use', body: 'Grass, dirt and one sad tree. Credit if you like, and show me what you build.' },
  ],
  'pointless-post-palace': [
    { title: 'Count to one thousand, one post at a time', body: 'One. Someone else does two. Nobody posts twice in a row or we start over.' },
    { title: 'Rate the username above you', body: 'Out of ten, with one reason. No reasons longer than five words.' },
    { title: 'Word association, go', body: 'Pipe. Next person says the first word that comes to mind, and so on until it gets weird.' },
    { title: 'This thread is about nothing', body: 'Please keep it that way. Posts with a point will be gently ignored.' },
    { title: 'Ban the person above you', body: 'For a made-up reason. Not a real ban. The staff are not in on this, probably.' },
  ],
};

const replies: readonly string[] = [
  'huh, never thought of it that way.',
  'ok but what about {interest}?',
  '{name}, you cannot just say that and leave.',
  'this is the {board} board. we used to talk about this stuff.',
  'bump.',
  'I have been thinking about {interest} all week, so this is timely.',
  'someone should make a game out of this.',
  'not sure how I feel, honestly.',
  '{name} is up to something, I can tell.',
  'lol.',
  'I was going to post about this exact thing.',
  'can we get a poll?',
  'this thread is going places.',
  'I read this twice and I am still not sure what you mean, {name}.',
  'screenshot or it did not happen.',
  'real talk, nobody here talks enough about {interest}.',
  'my cousin said the same thing at lunch.',
  'I will think about it and report back.',
  '{name} has opinions today, huh.',
  'you lost me at the second paragraph.',
  'that is a lot of words for a Tuesday.',
  'hmm. fair, I suppose.',
  'I came here to talk about {interest}, and I stayed for this.',
  'who else is awake right now?',
  'it is always {name} in these threads.',
  'okay, new idea: we all post our favorites and compare.',
  'this reminds me of an old thread I cannot find.',
  'I would watch a video essay about it.',
  'sorry, was I supposed to have an opinion?',
  'the real question is what happens after.',
  'I will be thinking about this in the shower.',
  'you could say that.',
  'not touching this one, {name}.',
  'moving on to talk about {interest}, who is with me?',
  'a lot of effort went into this post and it shows.',
  'I have notes but I will keep them to myself.',
  'somebody tell {name} the thread is on fire.',
  'a bold claim, let us see where it goes.',
  'this is why I keep checking the board.',
  'I was told there would be talk of {interest}.',
  'we are at page two and nobody has solved it yet.',
  'my main question is why.',
  'honestly the title got me.',
  'same energy as last week, {name}.',
  'oh no. here we go.',
  'quick, somebody quote this before it gets edited.',
  'is this about {interest} or am I confused?',
  'I like where this is going.',
  'consider me intrigued.',
  'wait, back up. what did {name} say?',
  'a thread for the ages, or for Tuesday at least.',
  'I will file this under things I did not need to know.',
  'sure, why not.',
  'let me get some popcorn.',
  'does anybody have a link?',
  'thanks for posting, I mean it.',
  'we should do this more often.',
  'I have so many questions and none of them are good.',
  'this thread owes me three hours.',
  'oh, {name} is here. now it is a party.',
];

const agreeing: readonly string[] = [
  'this, exactly this.',
  'well said, {name}.',
  'I could not have put it better.',
  'seconded.',
  'yes. all of this.',
  'finally someone says it.',
  'ten out of ten, no notes.',
  'I was thinking the same thing about {interest}.',
  'you are right and you should feel right.',
  'agreed, and I will add that this is why I keep reading about {interest}.',
  'preach, {name}.',
  'big same.',
  'this is the correct take.',
  'honestly, yes.',
  'good point, I stand corrected by my own opinion.',
  'I have been saying this for years.',
  'bookmarking this post.',
  '+1 and a gold star.',
  'that is what I meant, only better said.',
  'hard agree, {name}.',
];

const disagreeing: readonly string[] = [
  'respectfully, no.',
  'I think you are wrong about {interest}, {name}.',
  'that is not how it works.',
  'hard disagree.',
  'bold take. incorrect, but bold.',
  'you are mixing up two different things.',
  'no way. absolutely not.',
  'I disagree, and I brought receipts.',
  'this has been debunked, {name}.',
  'counterpoint: no.',
  'that take has no legs.',
  'I want to like this post but I cannot.',
  'the opposite is true and you know it.',
  'we are not doing this again, {name}.',
  'not even close, honestly.',
  'I see your point and I reject it.',
  'sorry, but everything I know about {interest} says otherwise.',
  'wrong board, wrong take.',
  'I will die on this hill, and it is the other hill.',
  'that is the worst thing I have read today.',
];

export const corpus: RehearsalCorpus = { sketches, openers, replies, agreeing, disagreeing };
