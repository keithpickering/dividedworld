/**
 * The glass routes, once: each path with its loader, its key and the screen it draws (the glass-load plan, Tasks 11 and 12). The composition
 * root (web/src/App.tsx) puts them in its routes with each screen loaded on first use (`lazyScreen`), and the screens' tests and stories
 * (loaded.tsx) put the same ones over screens imported directly, so the paths, loaders and keys cannot differ between the app and what is
 * tested. A glass route with no document loads its chunk alone.
 *
 * Routes that share one loader (and so one document) are built from one function here: the router keeps a document by its loader and key,
 * so a move between them, or a change of the chosen character, reads nothing.
 */
import type { ComponentProps, ComponentType, JSXElementConstructor, LazyExoticComponent } from 'react';
import type { ContactLink } from './data/api.ts';
import type { PictureIo } from './profile-edit/crops.ts';
import {
  alertsKey, charactersKey, loadAlerts, loadChunk, loadContact, loadLog, loadMyCharacters, loadQueue, loadSeason, loadSettings, loadUpdates, logKey,
  queueKey, seasonKey, settingsKey, updatesKey, type GlassEnv, type Preload,
} from './glass-docs.ts';
import type { Route } from './routes.tsx';
import type { SignInScreen } from './account/SignIn.tsx';
import type { SettingsScreen } from './account/Settings.tsx';
import type { Characters } from './characters/Characters.tsx';
import type { NewCharacter } from './characters/NewCharacter.tsx';
import type { ProfileEdit } from './profile-edit/ProfileEdit.tsx';
import type { SeasonScreen } from './season/Season.tsx';
import type { Vending } from './vending/Vending.tsx';
import type { AlertsScreen } from './alerts/Alerts.tsx';
import type { UpdatesScreen } from './updates/Updates.tsx';
import type { GuideScreen } from './guide/Guide.tsx';
import type { ContactScreen } from './contact/Contact.tsx';
import type { ConductScreen } from './conduct/Conduct.tsx';
import type { WelcomeScreen } from './welcome/Welcome.tsx';
import type { QueueScreen } from './admin/Queue.tsx';
import type { MachineScreen } from './admin/Machine.tsx';
import type { LogScreen } from './log/Log.tsx';
import type { SettlementScreen } from './log/Settlement.tsx';

/** A screen and the way to load it ahead: lazy in the app, the component itself (nothing to wait for) in a test. */
export interface GlassScreen<P> {
  readonly Component: ComponentType<P> | LazyExoticComponent<ComponentType<P>>;
  readonly preload: Preload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any screen's props
type Props<C extends JSXElementConstructor<any>> = ComponentProps<C>;

/** Every screen the glass routes draw. */
export interface GlassScreens {
  readonly signIn: GlassScreen<Props<typeof SignInScreen>>;
  readonly characters: GlassScreen<Props<typeof Characters>>;
  readonly newCharacter: GlassScreen<Props<typeof NewCharacter>>;
  readonly profileEdit: GlassScreen<Props<typeof ProfileEdit>>;
  readonly settings: GlassScreen<Props<typeof SettingsScreen>>;
  readonly season: GlassScreen<Props<typeof SeasonScreen>>;
  readonly vending: GlassScreen<Props<typeof Vending>>;
  readonly alerts: GlassScreen<Props<typeof AlertsScreen>>;
  readonly updates: GlassScreen<Props<typeof UpdatesScreen>>;
  readonly guide: GlassScreen<Props<typeof GuideScreen>>;
  readonly contact: GlassScreen<Props<typeof ContactScreen>>;
  readonly conduct: GlassScreen<Props<typeof ConductScreen>>;
  readonly welcome: GlassScreen<Props<typeof WelcomeScreen>>;
  readonly queue: GlassScreen<Props<typeof QueueScreen>>;
  readonly machine: GlassScreen<Props<typeof MachineScreen>>;
  readonly log: GlassScreen<Props<typeof LogScreen>>;
  readonly settlement: GlassScreen<Props<typeof SettlementScreen>>;
}

/** What a test gives a screen that the app does not: the picture codec of Edit profile, and the clock the queue's countdowns are read against. */
export interface GlassExtras {
  readonly io?: PictureIo;
  readonly now?: number;
}

/** The paths of the glass routes, in the table's order. */
export function glassRoutes(env: GlassEnv, s: GlassScreens, extras: GlassExtras = {}): readonly Route[] {
  const both = (...screens: readonly { readonly preload: Preload }[]) => () => Promise.all(screens.map((x) => x.preload()));
  /* My characters and Edit profile are one document, and so one loader. */
  const loadCharacters = () => loadMyCharacters(env, both(s.characters, s.profileEdit));
  /* My log and the settlement summary are one document, and so one loader. */
  const loadLogDoc = () => loadLog(env, both(s.log, s.settlement));
  const chunk = (x: { readonly preload: Preload }) => ({ load: () => loadChunk(x.preload) });
  const CharactersC = s.characters.Component;
  const ProfileEditC = s.profileEdit.Component;
  const SeasonC = s.season.Component;
  const AlertsC = s.alerts.Component;
  const UpdatesC = s.updates.Component;
  const ContactC = s.contact.Component;
  const ConductC = s.conduct.Component;
  const QueueC = s.queue.Component;
  const MachineC = s.machine.Component;
  const LogC = s.log.Component;
  const SettlementC = s.settlement.Component;
  const SettingsC = s.settings.Component;
  const SignInC = s.signIn.Component;
  const NewCharacterC = s.newCharacter.Component;
  const VendingC = s.vending.Component;
  const GuideC = s.guide.Component;
  const WelcomeC = s.welcome.Component;
  return [
    { path: '/characters', load: loadCharacters, key: charactersKey, render: (_, doc) => <CharactersC doc={doc as Props<typeof Characters>['doc']} /> },
    { path: '/characters/new', ...chunk(s.newCharacter), render: () => <NewCharacterC /> },
    { path: '/characters/edit', load: loadCharacters, key: charactersKey, render: (_, doc) => <ProfileEditC doc={doc as Props<typeof ProfileEdit>['doc']} io={extras.io} /> },
    {
      path: '/season', load: ({ query }) => loadSeason(env, query, s.season.preload), key: (_, query) => seasonKey(query),
      render: (_, doc) => <SeasonC doc={doc as Props<typeof SeasonScreen>['doc']} />,
    },
    { path: '/vending', ...chunk(s.vending), render: () => <VendingC /> },
    { path: '/alerts', load: () => loadAlerts(env, s.alerts.preload), key: alertsKey, render: (_, doc) => <AlertsC doc={doc as Props<typeof AlertsScreen>['doc']} /> },
    {
      path: '/updates', load: ({ query }) => loadUpdates(env, query, s.updates.preload), key: (_, query) => updatesKey(query),
      render: (_, doc) => <UpdatesC doc={doc as Props<typeof UpdatesScreen>['doc']} />,
    },
    { path: '/guide', ...chunk(s.guide), render: () => <GuideC /> },
    { path: '/contact', load: () => loadContact(env, s.contact.preload), render: (_, doc) => <ContactC doc={doc as readonly ContactLink[]} /> },
    { path: '/conduct', ...chunk(s.conduct), render: () => <ConductC /> },
    { path: '/welcome', ...chunk(s.welcome), render: () => <WelcomeC /> },
    { path: '/admin/queue', load: () => loadQueue(env, s.queue.preload), key: queueKey, render: (_, doc) => <QueueC doc={doc as Props<typeof QueueScreen>['doc']} now={extras.now} /> },
    { path: '/admin/machine', ...chunk(s.machine), render: () => <MachineC /> },
    { path: '/log', load: loadLogDoc, key: logKey, render: (_, doc) => <LogC doc={doc as Props<typeof LogScreen>['doc']} /> },
    { path: '/log/settlement', load: loadLogDoc, key: logKey, render: (_, doc) => <SettlementC doc={doc as Props<typeof SettlementScreen>['doc']} /> },
    { path: '/sign-in', ...chunk(s.signIn), render: () => <SignInC mode="sign-in" /> },
    { path: '/register', ...chunk(s.signIn), render: () => <SignInC mode="register" /> },
    {
      path: '/settings', load: ({ query }) => loadSettings(env, query, s.settings.preload), key: (_, query) => settingsKey(query),
      render: (_, doc) => <SettingsC doc={doc as Props<typeof SettingsScreen>['doc']} />,
    },
  ];
}
