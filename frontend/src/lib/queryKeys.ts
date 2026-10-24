/** TanStack Query keys, in one place so mutations invalidate the right lists. */
export const queryKeys = {
  users: ['users'] as const,
  health: ['health'] as const,
}
