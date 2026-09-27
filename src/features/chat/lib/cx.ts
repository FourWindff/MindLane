/** Joins truthy class names; the two chat components that build classes share this. */
export function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
