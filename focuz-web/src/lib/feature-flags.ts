import { isTest } from './app-env'

export const featureFlags = {
  // Quick filters: Activities filter (test-only)
  quickFiltersActivities: isTest,
  // Note creation and editing: add metric values (activities) from the composer
  noteCreateAddActivity: true,
} as const

