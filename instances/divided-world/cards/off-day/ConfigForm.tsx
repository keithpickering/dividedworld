/**
 * Off Day's setting in the play form: "The class it scores as", the instance's classes by name in the classes' own order (`ChoicePick`, native
 * radios). What it gives the form is `{ class }`, the key of the class, which `offDay.validateConfig` takes; untouched, nothing is chosen and the
 * play form waits for the player to name one. The classes are the instance's, read from the engine's context.
 */
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { ChoicePick } from '../quadrant-pick/ChoicePick.tsx';

export function ConfigForm({ config, onChange, id }: ConfigFormProps) {
  const { instance } = useKayfa();
  const chosen = typeof config?.class === 'string' && instance.classes.some((c) => c.key === config.class) ? config.class : undefined;
  return <ChoicePick legend="The class it scores as" name={`${id}-class`} options={instance.classes.map((c) => ({ value: c.key, label: c.name }))} value={chosen} onChoose={(key) => onChange({ class: key })} />;
}
