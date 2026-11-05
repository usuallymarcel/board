import type { Collection } from '../../api/types'

export interface TreeRow { collection: Collection; depth: number; hasChildren: boolean }

export function collectionTree(collections: Collection[], collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const byParent = new Map<string | null, Collection[]>()
  const known = new Set(collections.map((c) => c.id))
  for (const collection of collections) {
    const parent = collection.parent_id && known.has(collection.parent_id) ? collection.parent_id : null
    byParent.set(parent, [...(byParent.get(parent) ?? []), collection])
  }
  const rows: TreeRow[] = []
  const visit = (parent: string | null, depth: number) => {
    for (const collection of byParent.get(parent) ?? []) {
      const hasChildren = byParent.has(collection.id)
      rows.push({ collection, depth, hasChildren })
      if (hasChildren && !collapsed.has(collection.id)) visit(collection.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

/** The collection and everything under it: nothing here can become its parent. */
export function descendants(collections: Collection[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const c of collections) {
      if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true }
    }
  }
  return out
}

export function breadcrumbs(collections: Collection[], id: string): Collection[] {
  const byId = new Map(collections.map((c) => [c.id, c]))
  const trail: Collection[] = []
  for (let at = byId.get(id); at && trail.length < 32; at = at.parent_id ? byId.get(at.parent_id) : undefined) trail.unshift(at)
  return trail
}
