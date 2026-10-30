/**
 * What every screen reads: the backend (`KayfaApi`), the instance's rules and its look and words,
 * and the instance's screen settings. The composition root (web/, or a story) provides it; a
 * screen never imports an instance or a backend ("KayfaBB never knows which instance it runs").
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Instance } from '../rules/types.ts';
import type { KayfaApi, ScreenSettings } from './data/api.ts';
import type { InstanceUi } from './types.ts';

export interface Kayfa {
  readonly api: KayfaApi;
  readonly instance: Instance;
  readonly ui: InstanceUi;
  readonly settings: ScreenSettings;
}

const KayfaContext = createContext<Kayfa | null>(null);

export function KayfaProvider({ value, children }: { readonly value: Kayfa; readonly children: ReactNode }) {
  return <KayfaContext.Provider value={value}>{children}</KayfaContext.Provider>;
}

export function useKayfa(): Kayfa {
  const k = useContext(KayfaContext);
  if (!k) throw new Error('a screen is rendered inside a KayfaProvider, which the composition root gives it');
  return k;
}
