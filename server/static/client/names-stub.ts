// Stands in for core/names.ts inside site.js: the name generator is large and only a fusion needs
// it, so its one real copy lives in names.js and is bound here on the first fuse. Until then, any
// call throws (installSeason means nothing else ever asks for a name).
type Names = typeof import('../../../plugin/hooks/core/names.ts')
let impl: Names | null = null

export function bindNames(m: Names): void { impl = m }
const need = (): Names => {
  if (!impl) throw new Error('names are not loaded yet')
  return impl
}
export const speciesNames: Names['speciesNames'] = (...a) => need().speciesNames(...a)
export const fusionLine: Names['fusionLine'] = (...a) => need().fusionLine(...a)
export const mythicName: Names['mythicName'] = (...a) => need().mythicName(...a)
