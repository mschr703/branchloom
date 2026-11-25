import type { DesignElementStyle } from './design-inspection';

const LIMITS = { borderRadius: [0, 64], fontSize: [8, 48] } as const;
const KEYS = new Set(['color', 'backgroundColor', 'borderRadius', 'fontSize']);

/** Restrict live CSS edits to literal values that cannot fetch external resources. */
export function normalizeDesignElementStyle(value: unknown): DesignElementStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Wähle mindestens einen gültigen Stilwert.');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 4 || entries.some(([key]) => !KEYS.has(key))) throw new Error('Dieser Stilwert kann nicht getestet werden.');
  const result: DesignElementStyle = {};
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string' || raw.length > 32 || !raw.trim()) throw new Error('Stilwerte dürfen nicht leer sein.');
    const text = raw.trim();
    if (key === 'color' || key === 'backgroundColor') {
      if (!/^#[a-f\d]{6}$/i.test(text)) throw new Error('Farben brauchen sechs Hex-Ziffern, etwa #234b40.');
      result[key] = text.toLowerCase();
    } else if (key === 'borderRadius' || key === 'fontSize') {
      if (!/^(?:0|[1-9]\d?)(?:\.\d)?px$/.test(text)) throw new Error('Größe braucht einen px-Wert mit höchstens einer Dezimalstelle.');
      const number = Number(text.slice(0, -2));
      const [min, max] = LIMITS[key];
      if (number < min || number > max) throw new Error(`Erlaubt sind ${min} bis ${max} px.`);
      result[key] = `${number}px`;
    }
  }
  return result;
}
