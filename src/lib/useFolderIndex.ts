import { useLiveQuery } from 'dexie-react-hooks'
import { activities as activitiesRepo, activityTypes as activityTypesRepo, filters as filtersRepo, notes as notesRepo } from '../data'
import { buildFolderIndex, rulesUseActivities, type FolderIndex, type FolderRule } from './folders'

/** Live folder tree with what each folder shows, recomputed on any local or synced change. */
export function useFolderIndex(spaceId: number | null | undefined, ruleOverride?: { id: number; rule: FolderRule } | null): FolderIndex | undefined {
  return useLiveQuery(async () => {
    if (!spaceId) return undefined
    const [filters, notes] = await Promise.all([filtersRepo.listActiveBySpace(spaceId), notesRepo.listActiveBySpace(spaceId)])
    let activities: ((noteId: number) => Set<string> | undefined) | undefined
    const needActivities = rulesUseActivities(filters) || (ruleOverride?.rule.includeActivities.length ?? 0) > 0
    if (needActivities) {
      const [acts, types] = await Promise.all([activitiesRepo.listActiveForNotes(notes.map(n => n.id!)), activityTypesRepo.listAll()])
      const nameByType = new Map(types.map(t => [t.serverId!, t.name]))
      const byNote = new Map<number, Set<string>>()
      for (const a of acts) {
        const name = nameByType.get(a.typeId)
        if (!name) continue
        const set = byNote.get(a.noteId) || new Set<string>()
        set.add(name)
        byNote.set(a.noteId, set)
      }
      activities = (id) => byNote.get(id)
    }
    return buildFolderIndex(filters, notes, { activities, ruleOverride })
  }, [spaceId, ruleOverride ? JSON.stringify(ruleOverride) : ''])
}
