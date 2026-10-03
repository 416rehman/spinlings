// Claude's effort is a local look only: never a game rule, a timer or a request field (SPEC 10, 20.2).
export type Effort = 'low' | 'medium' | 'high' | 'max'

export const effortOf = (value: unknown): Effort =>
  value === 'low' || value === 'high' || value === 'max' ? value : 'medium'

export function effortLook(value: unknown): { opacity: number; width: number; vivid: boolean; bold: boolean } {
  switch (effortOf(value)) {
    case 'low': return { opacity: 0.3, width: 1, vivid: false, bold: false }
    case 'medium': return { opacity: 0.55, width: 1, vivid: false, bold: false }
    case 'high': return { opacity: 0.8, width: 1, vivid: true, bold: false }
    case 'max': return { opacity: 1, width: 2, vivid: true, bold: true }
  }
}
