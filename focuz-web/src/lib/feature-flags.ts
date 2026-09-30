import { isTest } from './app-env'

export const featureFlags = {
  // Quick filters: Activities filter (test-only)
  quickFiltersActivities: isTest,
  // Note creation: allow adding activities on create/reply (test-only)
  noteCreateAddActivity: isTest,
} as const

