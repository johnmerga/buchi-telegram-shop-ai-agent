/** The URL that a fake `fetch` was called with. */
export function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString();
}
