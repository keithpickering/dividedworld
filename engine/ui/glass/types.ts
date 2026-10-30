/**
 * The glass's types, where the glass's own files import them from. They are defined with the rest
 * of `InstanceUi` in engine/ui/types.ts, so that an instance's `InstanceUi.glass` and the glass
 * are written against one definition; this re-exports them. `ClassLargeDraw` is the engine's alone,
 * and sits beside `GlassSurface` there because the contrast guard reads the two together.
 */
export type {
  ClassLargeDraw, GlassClassColor, GlassFont, GlassKey, GlassOrbStops, GlassSize, GlassSurface, GlassTag, GlassTheme, GlassToken,
  SmokeDrift, SmokeLayer, SmokeRecipe,
} from '../types.ts';
