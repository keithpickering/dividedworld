/** Which of the account's two sound settings a sound answers to. */
export type SoundBus = 'game' | 'interface';
/** One sound an instance supplies (InstanceUi.sounds): a file the bundler resolved, its bus, and its caption, which the engine shows whenever it plays. */
export interface SoundSlot {
  readonly key: string;
  readonly src: string;
  readonly bus: SoundBus;
  /** What the caption bar says while it sounds, in sentence case ("The audience boos"); the bar draws it in capitals. Never empty. */
  readonly caption: string;
  /** A loop (a build-up) rather than a sound that ends. */
  readonly loop?: true;
  /** The caption's leading dot, any CSS color; none draws no dot. */
  readonly ink?: string;
}
export interface SoundsUi {
  readonly slots: readonly SoundSlot[];
  /** The sound a category's volume control plays when released, by key. */
  readonly preview?: Partial<Record<SoundBus, string>>;
}
