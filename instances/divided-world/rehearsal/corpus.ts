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

const sk = (key: string, name: string, pronouns: string, classKey: string, voice: string, interests: readonly string[], feuds: readonly string[], least: number, most: number): Sketch =>
  ({ key, name, pronouns, classKey, voice, interests, feuds, postsPerDay: { least, most } });

const sketches: readonly Sketch[] = [
  sk('mothwire', 'Mothwire', 'she', 'face', 'Warm and encouraging, signs off every post with a tiny pep talk.', [FANGAMES, GAMEMAKING, UNFINISHED], ['gravelbyte'], 1, 5),
  sk('gravelbyte', 'Gravelbyte', 'he', 'heel', 'Gruff and certain, treats every opinion he did not have first as a mistake.', [SPEEDRUN, RETRO, NINTENDO], ['mothwire', 'quillfern'], 1, 5),
  sk('tanukibrine', 'Tanukibrine', 'they', 'technician', 'Precise and a little pedantic, cites frame counts and sprite sheet dimensions.', [GAMEMAKING, FANGAMES, MUSIC], ['sodapop_rex'], 0, 3),
  sk('hexlantern', 'Hexlantern', 'they', 'lurker', 'Posts rarely, always one dry sentence, never explains the joke.', [MINUS, RETRO, FORUMS], [], 0, 1),
  sk('plumber_wick', 'Plumber Wick', 'he', 'jabroni', 'Loud, excitable and wrong about half the time, and cheerful about it.', [NINTENDO, FANGAMES, RETRO], ['quillfern'], 2, 6),
  sk('quillfern', 'Quillfern', 'she', 'tweener', 'Thoughtful reviewer who scores everything out of ten and defends the decimals.', [FANGAMES, GAMEMAKING, MUSIC, UNFINISHED], ['gravelbyte', 'plumber_wick'], 1, 4),
  sk('sodapop_rex', 'Sodapop Rex', 'he', 'heel', 'Contrarian by trade, opens with "actually" and means it.', [NINTENDO, RETRO, FORUMS], ['tanukibrine', 'mothwire'], 1, 5),
  sk('dingleberry_ox', 'Dingleberry Ox', 'they', 'jabroni', 'Posts in all lowercase with too many exclamation marks and no regrets.', [FANGAMES, MUSIC, FORUMS], [], 2, 6),
  sk('pocketcrane', 'Pocketcrane', 'she', 'face', 'Newcomer, polite to a fault, asks a question in every post.', [FANGAMES, GAMEMAKING, NINTENDO], [], 1, 4),
  sk('stratocumulo', 'Stratocumulo', 'they', 'tweener', 'Dreamy, drifts off topic into half-remembered games from childhood.', [RETRO, MUSIC, UNFINISHED], ['bolthole'], 0, 3),
  sk('bolthole', 'Bolthole', 'he', 'technician', 'Speedrunner who talks in splits and route changes and nothing else.', [SPEEDRUN, MINUS, RETRO], ['stratocumulo'], 1, 4),
  sk('crumpetmoon', 'Crumpetmoon', 'she', 'face', 'Spriter who shares work in progress and thanks everyone twice.', [GAMEMAKING, FANGAMES, FORUMS], [], 1, 4),
  sk('ironpudding', 'Ironpudding', 'she', 'heel', 'Dry, cutting and always right about level design, which is the worst part.', [GAMEMAKING, FANGAMES, UNFINISHED], ['crumpetmoon'], 1, 3),
  sk('waffleknight', 'Waffleknight', 'he', 'jabroni', 'Overconfident romhacker who announces a release date every week.', [GAMEMAKING, UNFINISHED, FANGAMES], ['ironpudding'], 2, 5),
  sk('lanternfish_97', 'Lanternfish 97', 'they', 'lurker', 'Long silences, then a single devastating bit of trivia.', [MINUS, RETRO, FORUMS, NINTENDO], [], 0, 1),
  sk('barnacle_jim', 'Barnacle Jim', 'he', 'tweener', 'Nostalgic forum veteran who remembers when signatures had a size limit.', [FORUMS, RETRO, MUSIC], ['dingleberry_ox'], 1, 4),
  sk('zephyrgoat', 'Zephyrgoat', 'she', 'technician', 'Glitch hunter who writes tidy step-by-step posts nobody asked for and everybody saves.', [MINUS, SPEEDRUN, GAMEMAKING, RETRO], [], 1, 3),
  sk('marmaladedrift', 'Marmaladedrift', 'she', 'face', 'Chiptune composer who answers every thread with a tune recommendation.', [MUSIC, RETRO, FANGAMES], [], 1, 4),
  sk('cobaltpretzel', 'Cobaltpretzel', 'he', 'heel', 'Hot takes served cold; says the beloved game is overrated and waits.', [NINTENDO, FANGAMES, RETRO], ['marmaladedrift', 'mothwire'], 1, 5),
  sk('nimbus_oat', 'Nimbus Oat', 'they', 'lurker', 'Reads everything, posts a short agreeing line once a week.', [FORUMS, FANGAMES, MUSIC], [], 0, 1),
  sk('rustpuddle', 'Rustpuddle', 'they', 'jabroni', 'Chaotic, posts a screenshot with no context and the word "behold".', [MINUS, FANGAMES, UNFINISHED], ['hexlantern'], 2, 6),
  sk('velveteen_kip', 'Velveteen Kip', 'he', 'tweener', 'Earnest level designer who rewrites his own opinions mid-thread.', [GAMEMAKING, FANGAMES, SPEEDRUN], ['ironpudding'], 1, 4),
  sk('glimmerjaw', 'Glimmerjaw', 'she', 'technician', 'Engine nerd who answers a joke with a changelog.', [GAMEMAKING, RETRO, NINTENDO, MUSIC], ['plumber_wick'], 0, 3),
  sk('toadstool_annie', 'Toadstool Annie', 'she', 'face', 'Community organizer, runs the monthly contest and nags kindly about deadlines.', [FANGAMES, GAMEMAKING, FORUMS], ['sodapop_rex'], 1, 4),
  sk('cinderblock', 'Cinderblock', 'he', 'heel', 'Speedrun purist who thinks glitchless is the only honest category.', [SPEEDRUN, NINTENDO, RETRO], ['zephyrgoat'], 1, 4),
  sk('sleepyfig', 'Sleepyfig', 'they', 'lurker', 'Appears at night, posts a wistful line about a game nobody finished.', [UNFINISHED, MINUS, RETRO], [], 0, 2),
  sk('copperwhistle', 'Copperwhistle', 'she', 'tweener', 'Reviewer of tiny games, generous with praise and stingy with scores.', [FANGAMES, UNFINISHED, GAMEMAKING, MUSIC], ['quillfern'], 1, 3),
  sk('puddingbandit', 'Puddingbandit', 'he', 'jabroni', 'Joker whose bits run three posts too long.', [FORUMS, NINTENDO, FANGAMES], ['barnacle_jim'], 2, 5),
  sk('anchorite_moss', 'Anchorite Moss', 'they', 'technician', 'Quiet pixel artist, posts palettes and nothing else for weeks.', [GAMEMAKING, FORUMS, MUSIC], [], 0, 2),
  sk('frostbitten_ned', 'Frostbitten Ned', 'he', 'heel', 'Sarcastic old-timer, insists the forum peaked before he joined it.', [FORUMS, RETRO, MINUS], ['pocketcrane', 'dingleberry_ox'], 1, 4),
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
    { title: 'What are you playing this weekend?', body: 'I am replaying an old platformer I have beaten ten times. Tell me what is on your screen right now.' },
    { title: 'Best game you finished in one sitting', body: 'Mine was a short puzzle game, three hours start to end, and I did not look up once. Yours?' },
    { title: 'Which console had the best game library?', body: 'I know the answer is whichever one you had as a kid. Prove me wrong anyway.' },
    { title: 'A sequel that was better than the original', body: 'They are rare, but I can think of three. Name yours and defend it.' },
    { title: 'Games you keep meaning to start', body: 'My backlog is a tower of cases. Which one should I play first? Pick for me.' },
    { title: 'Hardest boss you ever beat', body: 'I mean the one you threw the controller over. Bonus points if you beat it with one heart.' },
  ],
  'movies-tv': [
    { title: 'What are you watching right now?', body: 'I started a show last night and I am already three episodes deep. Recommend me something next.' },
    { title: 'A movie everyone loves that you just do not get', body: 'I tried twice. It is fine. It is just fine. Tell me what I am missing.' },
    { title: 'Best cartoon from when you were a kid', body: 'I can still hum the theme song. Post yours and let us see who is oldest.' },
    { title: 'Rewatching old favorites: comfort or trap?', body: 'I have seen the same movie six times this year. Is that sad or is that taste?' },
    { title: 'Worst movie you enjoyed anyway', body: 'It was awful. The acting, the plot, all of it. I laughed the whole way through.' },
    { title: 'Movie adaptations of games: any good ones?', body: 'I keep hoping one will be good. Tell me I am not just setting myself up again.' },
  ],
  'arts-crafts': [
    { title: 'Post your work in progress', body: 'Sprites, sketches, a half-finished song, anything. I will start: a tileset that is only grass so far.' },
    { title: 'What do you use to draw your pixel art?', body: 'I have been using the same tiny program for years and I wonder if I am missing out. What is your tool?' },
    { title: 'Drawing a character in under an hour', body: 'I set a timer and tried it. The face came out wrong but the hat is great. Who else wants to try?' },
    { title: 'Share a tune you wrote', body: 'It does not have to be good. Mine is eight bars long and loops forever. Let me hear yours.' },
    { title: 'Writing a short story set in a game world', body: 'I have a plot about a plumber who just wants a quiet afternoon. Anyone want to read a draft?' },
    { title: 'Show me your messy desk', body: 'Pencils, a half-eaten snack, and three tablets. Where do you make your art?' },
  ],
  help: [
    { title: 'How do I start making a fangame?', body: 'I have a few sprites and a lot of ideas, but no idea what to open first. Where should a beginner begin?' },
    { title: 'My emulator runs too fast, what setting is it?', body: 'The game plays at double speed and I cannot find the option. I checked the video menu twice.' },
    { title: 'Best free tool for making sprites?', body: 'I need something simple with a color palette and layers. What do you use and why?' },
    { title: 'My level will not load after I added a pipe', body: 'It worked until the last pipe I placed. Now it shows a black screen. Did I break something?' },
    { title: 'How do I get sound working in my game?', body: 'The music plays but the jump sound never does. I am sure I did everything the tutorial said.' },
    { title: 'What size should my tiles be?', body: 'I drew sixteen by sixteen but my friend says thirty-two. Does it matter this early?' },
  ],
  'pointless-post-palace': [
    { title: 'hello', body: 'That is it. That is the post.' },
    { title: 'I have a sandwich', body: 'I thought you should know. It is a good one.' },
    { title: 'Today I looked at a wall', body: 'It was beige. I do not have anything else to add.' },
    { title: 'Does anyone else hear that humming', body: 'It might be the fridge. It might be nothing. Anyway, hello.' },
    { title: 'A very important announcement', body: 'There is no announcement. Thank you for coming.' },
    { title: 'My sock is a different sock now', body: 'It was a sock. It is still a sock. Something feels off, though.' },
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

const anyBoard: RehearsalCorpus['anyBoard'] = [
  { title: 'First post on {board}!', body: 'Somebody has to go first. What is this place for, exactly?' },
  { title: 'Is {board} the right board for this?', body: 'I was going to post this somewhere else and then {board} showed up. So here it is.' },
  { title: 'Rules for {board}?', body: 'Before anyone gets visited: what counts as on topic in {board}? Asking for me.' },
  { title: 'Moving in to {board}', body: 'Brought my posts over. Where do I put them?' },
  { title: 'Who made {board}?', body: 'It was not here yesterday. I am not complaining. I am a little complaining.' },
];

export const corpus: RehearsalCorpus = { sketches, openers, anyBoard, replies, agreeing, disagreeing };
