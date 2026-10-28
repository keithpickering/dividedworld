# **Minds struggle to stay intact in a**

# **DIVIDED WORLD**

# **MVP Architecture & Product Specification**

# **1\. Executive Summary & Core Philosophy**

**Divided World** (dw.gripe) is a kayfabe-style multiplayer RPG disguised as an early-2000s BBCode message board (inspired by Minus World, WWE crowd psychology, Neopets, and *Paper Mario: The Thousand-Year Door*).

> * **Always a Game First:** Every interpersonal interaction is a mix of authentic commentary and played-up character performance. Figuring out who is serious, who is working a bit, and what secret Character Class someone is playing is the core meta-game.  
> * **Strict Kayfabe Separation:** Registered User accounts ("the person behind the mask") are strictly decoupled from public Player Characters. No public UI or API payload ever exposes which User owns which Character.  
> * **Everything is an "Act":** Every additive or destructive action on the site (posting, editing, applying a Postcard, Mod Bot punishments, ownership transfers) is logged as a polymorphic Act that can be reacted to or spun out into its own discussion Thread via a global Floating Action Button (FAB).

# **2\. Tech Stack & Design System**

## **2.1 Technical Architecture**

> * **Domain:** dw.gripe  
> * **Frontend:** Vite \+ React (TypeScript).  
> * **Animation & Skeuomorphism:** Framer Motion (driving intricate, tactile UI animations—orb filling, card applications, DOM-crawling Mod Bots—juxtaposed against stark 2000s table/box layouts).  
> * **Component Workbench:** Storybook (enforcing a strict, consistent, semantic, and WCAG-accessible classic web UI kit).  
> * **Backend & Realtime:** Supabase (PostgreSQL, Supabase Auth, Row-Level Security, Supabase Realtime Channels & Broadcast/Presence for zero-refresh live threads/reactions/acts/Mod Bots, Edge Functions \+ pg\_cron for scheduled jobs).  
> * **AI / LLM Layer:** Claude Haiku 5.5 via Supabase Edge Functions (used strictly in bounded, single-shot structured JSON calls for the Weekly Board Generator and Mod Bot Appeals).

## **2.2 Brand & Visual Identity**

> * **Typography:** Strictly web-safe Verdana (body/UI) and Bold Courier / Courier New (headers, system logs, Acts, monospace tickers).  
> * **Color Palette:** High-contrast binary themes.  
  * **Dark Mode:** \#FFFFFF text/borders on \#000000 background.  
  * **Light Mode:** \#000000 text/borders on \#FFFFFF background.  
  * **Accents:** Reserved strictly for skeuomorphic game elements (Aura orbs, Postcard effects, Mod Bot indicators, Emotion reactions).  
> * **Accessibility:** All skeuomorphic and animated elements must use semantic HTML (\<article\>, \<section\>, \<button\>, aria-live regions for live thread updates) and respect prefers-reduced-motion fallbacks.

# **3\. Core Entities & Database Schema (Supabase Postgres)**

## **3.1 Users & Account Inventory (Private / Root Level)**

> * **users (Managed via Supabase Auth):** 1 email \= 1 login.  
> * **account\_settings:** Stores user preferences and current active character\_id.  
> * **account\_inventory:** Postcards, Consumable Items, and Trophies belong to the **Account** (usable by any active Character owned by that User).  
> * **site\_config:** Global key-value settings (e.g., max\_characters\_per\_user \= 6, max\_monthly\_violations \= 5).

## **3.2 Characters & "The Pound" (Public Persona Level)**

> * **characters:**  
  * id, owner\_user\_id (strictly hidden via RLS/views—never exposed to client queries for other users), name, avatar\_url, bio, signature\_bbcode.  
  * current\_class (strictly private/hidden column: FACE, HEEL, JESTER, LURKER), last\_class\_change\_at (cooldown: 30 days).  
  * aura\_points (float, 0.00 to 6.00 representing 6 Orbs).  
  * status (ACTIVE, ABANDONED).  
> * **Character Switching:** Global quick-swap dropdown in the persistent header/composer bar allowing instant hot-swapping between a User's active Characters without page reload.  
> * **The Pound (Adoption Mechanic):**  
  * A User can voluntarily abandon a Character to the Pound to free up one of their 6 character slots.  
  * Any other User with an open slot can adopt the Character from the Pound.  
  * Adopting a Character retains all of its Aura, Trophies, Post history, and baggage.  
  * **Public Ownership Log:** Abandoning and adopting logs a public CHARACTER\_OWNERSHIP\_TRANSFERRED Act on the character's history (with User identities completely omitted).

## **3.3 Polymorphic "Acts" Engine**

> * **acts:** The atomic unit of Divided World.  
  * id, actor\_character\_id (nullable if actor is THE\_SYSTEM or MOD\_BOT), act\_type (POST\_CREATED, POST\_EDITED, POST\_DESTROYED, POSTCARD\_USED, MOD\_PUNISHMENT, APPEAL\_RESULT, OWNERSHIP\_TRANSFER, CLASS\_TURN\_RETROACTIVE).  
  * target\_act\_id (nullable self-reference), thread\_id, board\_id.  
  * payload (JSONB storing post BBCode content, postcard metadata, or system messages).  
  * active\_effects (JSONB array of applied Postcard instances and their persisted state, e.g., laminated, font\_override, time\_bomb\_expires\_at, splat\_bitmask).  
  * is\_destroyed (boolean—allows "destroyed" posts to remain as tombstone Acts that can be reacted to or resurrected via necromancy items).

# **4\. Boards, Threads, and Live Interaction**

## **4.1 The Weekly Board Cycle & "The System"**

> * **The Situation Room:** Pinned permanently at the top of the forum index. Traditional long-lived threads. Metagame Discussion encouraged. A non-meta thread from this board may be selected to be thrust into a themed board if The System decides it during the weekly turnover. Posting in the Situation Room does not award Aura.  
> * **Ephemeral Weekly Boards:** Every week (via pg\_cron \+ Edge Function), all non-Situation Room boards from the prior week are marked is\_archived \= true (read-only), unless saved or resurrected.  
> * **The LLM Board Generator (weekly-board-cron):**  
  * **Input Prompt:** Receives a sample of posts/threads from each active board over the past week, top reaction spikes, and a list of retired historical boards (both beloved and hated).  
  * **Survival / "Clearing" Evaluation:** The System arbitrarily judges whether each board met its topical quota (e.g., did people talk meaningfully enough about "Dirt"?).  
    * **If Not Met:** The board survives into the next week, and its difficulty threshold lowers slightly ("eh, good enough" decay).  
    * **If Met ("Board Cleared\!"):** The board is retired into the Hall of History, and every Character who posted in it during the week is granted a collective reward (Aura boost or a specific Postcard/Trophy selected by the LLM from a whitelist).  
  * **New Board Generation:** Outputs structured JSON creating the new week's boards—mixing normal boards, hamfisted spin-offs of popular threads (tempered by anti-fatigue rules so one topic doesn't dominate every week), bizarre hyper-specific prompts, and occasional un-archived boards brought out of retirement (which restores their old threads to read/write status). Encourages web searches to make boards based on recent events related to the community’s demonstrated interests (likes or strong dislikes).

## **4.2 Threads & Posts UX**

> * **Zero-Refresh Live Updates:** Powered by Supabase Realtime. New posts, inline Acts, Postcard mutations, and Emoji reactions appear instantaneously.  
> * **Hybrid Navigation:** Supports classic static pagination (?page=3\#post-142 for shareable permalinks and fresh loads) alongside smooth "Load Next / Infinite Scroll" and a "Skip to Latest" jump button while actively reading.  
> * **Infinite Nested Multiquote:** Highlighting any text snippet in any post pops up a contextual \[+ Quote\] tooltip, or users can quote whole posts, supporting infinite nested BBCode-style quote blocks.  
> * **Global Floating Action Button (FAB) — "Spin Thread from Act":**  
  * Accessible anywhere on the site. Users can select any visible Act onscreen (a post, a Mod Bot ban, a Postcard attack) to spawn a new Thread about it.  
  * **Act-as-OP Styling:** The target Act becomes the specially styled "Original Post" card at the top of the new Thread (with a link back to its origin), and the spawning Character writes their commentary as Post \#1 directly underneath.

# **5\. The RPG Loop: Secret Classes, Emotions, & Aura**

## **5.1 The 4-Quadrant Emotion Reaction System**

Any Act (except another reaction) can receive **anonymous emoji reactions**. Reactions are mapped onto Russell's Circumplex Model of Affect across four quadrants:

> * **Quadrant 1 — High Arousal / Positive (Excited, Delighted, Happy):** e.g., 🔥, ❤️, 🙌, 🤩  
> * **Quadrant 2 — High Arousal / Negative (Tense, Angry, Frustrated):** e.g., 🍅, 😡, 🤬, 👎  
> * **Quadrant 3 — Low Arousal / Positive (Content, Relaxed, Calm):** e.g., 😌, ☕, 🤝, 🧘  
> * **Quadrant 4 — Low Arousal / Negative (Depressed, Bored, Tired):** e.g., 💤, 🙄, 🗑️, 🥱

## **5.2 Secret Character Classes, "Turns", & Anti-Griefing Wards**

To prevent other players from intentionally griefing a Character's Aura by reverse-engineering their class, **a Character's current Class is strictly hidden from all other players.**

> * **Class Selection & Cooldown:** Chosen at Character creation. Once every 30 days (or seasonally), a player can execute a **Class Turn** in their private character menu.  
> * **Retroactive Turn Reveal:** When a Character executes a Turn, the system can optionally log a delayed/retroactive Act (e.g., revealing what Class they *used* to be during the prior month without exposing what they just turned into).  
> * **Anti-Griefing Reaction Wards (Server-Side Resolution):** A character who is famously suspected of being a certain class may experience targeted griefing reactions. To counter this without breaking reaction anonymity:  
  * **act\_reactions Table:** Stores id, target\_act\_id, reactor\_character\_id (strictly hidden from client queries via RLS), and emoji\_id (mapped to one of the 4 Quadrants).  
  * **character\_wards Table:** Stores warded\_character\_id, suspected\_griefer\_character\_id, effect\_type (REVERSE\_VALENCE \| REVEAL\_REACTOR), and expires\_at.  
  * **Postgres Trigger Calculation:** When a reaction is inserted, a server-side Postgres trigger evaluates the Aura delta. If the target Character has an active REVERSE\_VALENCE Ward naming the reactor\_character\_id, the trigger silently inverts the quadrant math (turning a hostile/draining reaction into a favored Aura boost) without notifying the griefer that their reactions are healing the target.

| Class | Favored Quadrant (Aura Gain) | Hostile Quadrant (Aura Drain) | Special Passive / Mechanic |
| :---- | :---- | :---- | :---- |
| **Face** | **Top-Right** (High Arousal \+ Positive) | **Bottom-Left** (Low Arousal \+ Negative / Boredom) | Bonus Aura when defending posts or clearing boards. |
| **Heel** | **Top-Left** (High Arousal \+ Negative / Heat) | **Bottom-Right** (Low Arousal \+ Positive / Polite) | Gains "Cheap Heat" Aura from receiving angry reactions and using destructive Postcards. |
| **Jester** | **Top-Left & Top-Right Extremes** (High Arousal Chaos) | **Bottom-Left** (Double penalty from Boredom/Crickets) | Bonus Aura when applying or being targeted by Postcard effects. |
| **Lurker** | **Bottom-Right** (Low Arousal \+ Positive) | **High Posting Volume** (Penalized for spamming posts) | Rarely posts. Earns primary Aura by *giving* early reactions that align with subsequent crowd consensus and spawning active Threads from others' Acts. |

## **5.3 The 6-Orb Aura Meter (*Paper Mario: TTYD* Style)**

> * Rendered in the UI as 6 skeuomorphic Orbs, each with a sub-progress fill bar (0.00 to 6.00).  
> * **Aura is Currency:** Earned via crowd reactions/class alignment and spent at the Vending Machine or consumed as fuel to cast high-powered Postcards.

# **6\. The Vending Machine, Postcards & Trophies**

## **6.1 The Vending Machine**

Characters spend their earned Aura Orbs at the **Vending Machine** to acquire items for their shared **Account Inventory**:

> * **Direct Purchase Slots:** Buy specific reliable Postcards at a fixed Orb price.  
> * **Gacha Capsule Pulls:** Spend a smaller/fixed Orb amount for a randomized pull with a chance at rare/catastrophic Postcards.

## **6.2 Extensible Postcard Plugin Architecture (Zero-Migration Design)**

Postcards have both an **Acquisition Cost** (at the Vending Machine) and an optional **Activation Requirement / Aura Cost** when played on a post. Because the roster will scale to dozens or hundreds of cards with cross-effect interactions, **adding new Postcards must never require database schema migrations.**

> * **Database Representation:** Applied Postcards live inside the active\_effects JSONB array on the target acts row. Each entry follows a standard envelope:  
>   `{`  
>     `"instance_id": "uuid",`  
>     `"card_type": "SPLAT",`  
>     `"applied_by_character_id": "uuid",`  
>     `"applied_at": "timestamp",`  
>     `"expires_at": "timestamp | null",`  
>     `"config": { "custom_text": "..." },`  
>     `"state": { "grid_bitmask": "011011..." }`  
>   `}`

> * **Frontend Postcard Registry (PostcardRegistry.ts):** Every Postcard is a self-contained TypeScript plugin implementing a unified interface:  
  1. calculateCost(targetAct, config): { requiredOrbs: number, consumedOrbs: number } — Computes dynamic activation costs (e.g., scaling by post character length for *Splat* or substring match count for *Autocorrect*).  
  2. canApply(targetAct): boolean — Checks conflicts/immunities (e.g., returns false for destructive cards if active\_effects contains an active LAMINATE instance).  
  3. WrapperDecorator: React.FC — Wraps the Postbit container in composable Framer Motion layers (handles *Laminate* plastic sheen, *Shredder* physics strips, *Splat* HTML5 canvas overlay, or *Stick Around* IntersectionObserver scrolljacking).  
  4. TextASTMutator(bbcodeAST, effectState) — Mutates parsed text nodes prior to render (handles *Autocorrect* peelable sticky-label DOM nodes).  
  5. onInteract(actId, instanceId, deltaState) — Calls a single debounced Supabase RPC (update\_postcard\_effect\_state) to persist interactive changes (e.g., saving a compact 32x32 bitmask on pointerUp when pressure-washing a *Splat* post, preventing high-frequency DB writes).

## **6.3 MVP Postcard Roster (1 Card \= 1 Act on 1 Post)**

| Card Name | Rarity | Activation Cost | Effect Summary |
| :---- | :---- | :---- | :---- |
| **Splat** | Uncommon | Depends on post size | Cover the target post in an ink splat which must be sprayed away by the poster using a pressure washer (click and drag the mouse). The wash progress is saved to the database (state.grid\_bitmask) so the receiver can wash it all over time, or even draw something in it for others to see. |
| **Autocorrect** | Common | Depends on frequency of term | Find and replace a string of text within the target post with sticky labels containing a new string of text. Viewers must drag to peel the labels off to view the real text underneath. |
| **Stick Around** | Common | 1 Orb | Scrolljack users back to the target post on scrollEnd until they check a box “legally certifying” that they have read the post in full and thought about it contemplatively (custom message by the card user; certification saved in viewer's local/session state). |
| **Laminate** | Uncommon | 2 Orbs | Seals a post in skeuomorphic plastic. Makes it immune to destructive Postcards and preserves it nicely in the archive. |
| **Timebomb** | Rare | 3 Orbs | Attaches a ticking countdown clock to a post. If another user doesn't defuse or laminate it in time, it explodes into a POST\_DESTROYED Act. |
| **Aura Void** | Rare | Scales with time in effect | Prevent the poster from gaining any Aura from the target post for a duration selected by the card user. |
| **Shredder** | Epic | Requires 5, Consumes 3 | Immediately shreds a non-laminated post into strips which fall into a pile with realistic physics, converting it into a \[Destroyed by Postcard\] tombstone Act. |
| **Rebirth** | Epic | Requires 5, Consumes 3 | Targets a POST\_DESTROYED tombstone Act and restores the original post back into existence. |

## **6.4 Trophies & Badges**

> * Awarded for site milestones, surviving Mod Bot appeals, or clearing stubborn weekly boards.  
> * Displayed on a Character's profile/postbit; select Trophies provide passive buffs (e.g., *10% discount at the Vending Machine*, or *Chance to not consume a Common Postcard on use*).

# **7\. Autonomous Moderation: Mod Bots & Unreasonable Appeals**

## **7.1 Synchronized DOM-Crawling Mod Bots & Personas**

There are no human moderators visible in the game loop (actual admin tools for TOS/illegal content removal operate silently in the background without logging game Acts).

> * **Arbitrary & Reactionary Rules:** Posting off-topic outside the Situation Room, tripping arbitrary keyword rules, or random system sweeps spawns a **Mod Bot** in the thread. Rules change frequently and arbitrarily, often acting as knee-jerk overcorrections to recent forum events (mimicking shaky, ineffectual forum leadership). Users receive global notifications whenever rule changes occur, but **zero notifications** when a Mod Bot targets their post.  
> * **Consistent Mod Bot Personas (mod\_bot\_personas):** Each Mod Bot has a persistent identity, sprite, and psychological quirk that dictates how it patrols and what kind of flattery/argument works on it during an Appeal:  
  * *Example 1 — Bailiff-01 ("The Bureaucrat"):* Obsessed with imaginary sub-clauses and form numbers; weak to pedantic legalistic groveling.  
  * *Example 2 — Hazard-X ("The Hothead"):* Respects only bold kayfabe bravado; automatically escalates polite apologies.  
  * *Example 3 — NetNanny-99 ("The Moralist"):* Overreacts to mild slang; easily distracted by shiny Bait items.  
> * **Real-Time Multiplayer Synchronization (DOM-Anchor State Machine):**  
  * Mod Bots exist as live shared objects inside a thread (1 active bot per thread at a time) synchronized across all connected viewers via **Supabase Realtime Broadcast & Presence**.  
  * Because screen resolutions vary, bot position is broadcast using **semantic DOM-Anchor coordinates** rather than raw pixels: { bot\_persona\_id, state: 'PATROLLING' \| 'INSPECTING\_ACT' \| 'CRAWLING\_TO\_ESCAPE' \| 'FOLLOWING\_CHARACTER' \| 'DISTRACTED\_BY\_BAIT', anchor\_act\_id, progress\_float: 0.0..1.0, aggro\_character\_id }.  
  * Each client's Framer Motion layer smoothly interpolates the bot sprite relative to the referenced \<article id="act-XYZ"\> DOM node on screen.  
> * **Aggro, Scrutiny & Bait Mechanics:**  
  * If a user clicks UI buttons near an inspecting Mod Bot or lingers with their cursor/viewport on it for too long, the client emits a mod\_bot\_aggro broadcast event.  
  * The Mod Bot may abandon the post it was reviewing, latch onto that user's active Character (FOLLOWING\_CHARACTER), and scrutinize their next post with heightened strictness.  
  * Users can deploy a consumable **Bait Item** onto the thread DOM, switching the bot to DISTRACTED\_BY\_BAIT and keeping it occupied for several minutes.  
> * **The Escape & Trivia Interception:**  
  * After reviewing a post for a few minutes, the Mod Bot transitions to CRAWLING\_TO\_ESCAPE, slowly meandering up the page toward the top of the thread.  
  * *Any* user currently viewing the thread can click the crawling bot before progress\_float reaches 1.0. Clicking opens a modal with a single, bizarre/dumb multiple-choice trivia question pulled from the database:  
    * **Success:** The Mod Bot short-circuits, the report is canceled, and the rescuer gets a small Aura pop.  
    * **Failure (or Bot Escapes):** The Mod Bot files its report with **The System**, executing an arbitrary punishment Act (e.g., redacting the post, temporarily banning the Character from that specific board, or fining 1 Aura Orb).

## **7.2 Bounded Haiku 5.5 Appeals**

> * **Strict Rate Limiting:** A user/character is capped at X violations per month (e.g., 5), and each Mod Bot punishment Act allows **strictly one single-shot Appeal submission** (no back-and-forth chat).  
> * **The Appeal Flow:** The punished Character clicks \[Appeal to The System\] on the punishment Act and submits a short text plea (max 500 characters).  
> * **Haiku 5.5 Evaluation:** An Edge Function sends the original post, the arbitrary rule broken, the arresting **Mod Bot's Persona profile**, and the player's plea to **Claude Haiku 5.5** with a rigid JSON schema response: verdict (OVERTURNED, UPHELD, ESCALATED), system\_reasoning (written in the voice of the specific Mod Bot / System), and consequence.  
> * **Outcomes:**  
  * OVERTURNED: Punishment reversed \+ Character receives a rare bureaucratic apology Trophy.  
  * UPHELD: Nothing changes; the robot mocks the plea publicly.  
  * ESCALATED: The punishment is doubled (e.g., Aura drained to zero, post shredded) and logged as a public APPEAL\_REJECTED\_CATASTROPHICALLY Act.

# **8\. Out of Scope for MVP (Deferred to Milestone 2\)**

To keep the initial build tight and focused, the following items are explicitly deferred:

> * Peer-to-peer Item/Postcard trading between accounts.  
> * Multi-slot RPG Character Equipment screens (beyond passive Trophies and Account-level consumables).  
> * Custom user-uploaded emoji reactions (MVP will use a curated set of standard \+ unlockable pixel/skeuomorphic reactions).

# **9\. Suggested Implementation Phases for Claude Coding Session**

> 1. **Phase 1: Storybook & Classic UI Kit:** Build the \#000/\#fff Verdana/Courier components, layout tables, TTYD 6-Orb Aura Bar, Postbit, and Framer Motion wrappers in Storybook with full semantic accessibility.  
> 2. **Phase 2: Supabase Schema, RLS & Kayfabe Views:** Set up users, characters (with secure PostgreSQL views that strip owner\_user\_id and current\_class from public queries), boards, threads, acts, act\_reactions, and character\_wards.  
> 3. **Phase 3: Realtime Forum Loop & FAB:** Implement live threads via Supabase Realtime, nested multiquoting, quick-swap Character bar, The Pound adoption flow, and the "Spin Thread from Act" FAB.  
> 4. **Phase 4: Aura Engine, Vending Machine & Postcard Plugin Registry:** Implement the 4-Quadrant anonymous reactions \+ Server-side Ward trigger, hidden Class math, Vending Machine (Direct \+ Gacha), the PostcardRegistry plugin architecture, and the 8 MVP Postcard effects.  
> 5. **Phase 5: The System (DOM-Anchor Mod Bots, Haiku 5.5 Appeals & Weekly Cron):** Build the synchronized DOM-crawling Mod Bot state machine \+ Personas \+ Bait/Aggro \+ Trivia modal, single-shot Haiku 5.5 Appeal Edge Function, and the Weekly Board Generator cron job.