export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slack = 96,
): boolean {
  return scrollHeight - scrollTop - clientHeight < slack
}
