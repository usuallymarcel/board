import { Copy, Download, ExternalLink, FolderInput, Pencil, Pin, PinOff, Share2, Trash2 } from 'lucide-react'
import { create } from 'zustand'
import { ApiError, api, exportUrl, fileUrl } from '../../api/client'
import type { Item } from '../../api/types'
import { queryClient } from '../../app/queryClient'
import { askText } from '../../ui/dialogs'
import type { MenuEntries } from '../../ui/Menu'
import { toast } from '../../ui/primitives'

/** Which item sheet is open. A store, so any row, page or menu can open one. */
export const useSheets = create<{ move: { ids: string[] } | null; share: Item | null; file: Item | null }>(() => ({
  move: null, share: null, file: null,
}))

export const refreshItems = () => Promise.all(['items', 'collections', 'usage', 'item-detail'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))

export const failed = (err: unknown) => toast(err instanceof ApiError ? err.message : 'That did not work. Check your connection.')

export const itemPath = (item: Pick<Item, 'id' | 'kind'>) => (item.kind === 'note' ? `/notes/${item.id}` : `/boards/${item.id}`)

export function download(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = ''
  link.click()
}

export async function trashItems(ids: string[]) {
  try {
    await api.bulk(ids, 'trash')
    await refreshItems()
    toast(ids.length === 1 ? 'Moved to trash' : `${ids.length} items moved to trash`, {
      label: 'Undo',
      run: () => void api.bulk(ids, 'restore').then(refreshItems, failed),
    }, 7000)
  } catch (err) { failed(err) }
}

export async function moveItems(ids: string[], collectionId: string | null, undo?: (string | null)[]) {
  try {
    await api.bulk(ids, 'move', collectionId)
    await refreshItems()
    if (undo) {
      toast(ids.length === 1 ? 'Moved' : `${ids.length} items moved`, {
        label: 'Undo',
        run: () => void Promise.all(ids.map((id, i) => api.patchItem(id, { collection_id: undo[i] ?? null }))).then(refreshItems, failed),
      })
    }
  } catch (err) { failed(err) }
}

export async function renameItem(item: Item) {
  const title = await askText({ title: 'Rename', label: 'Name', value: item.title })
  if (!title || title === item.title) return
  await api.patchItem(item.id, { title }).then(refreshItems, failed)
}

export const setPinned = (ids: string[], pinned: boolean) => api.bulk(ids, pinned ? 'pin' : 'unpin').then(refreshItems, failed)

export const duplicateItem = (item: Item) =>
  api.duplicate(item.id).then(async () => { await refreshItems(); toast('Copied') }, failed)

export function itemMenu(item: Item, open?: () => void): MenuEntries {
  return [
    open ? { label: 'Open', Icon: ExternalLink, run: open } : null,
    { label: 'Rename', Icon: Pencil, run: () => void renameItem(item) },
    { label: item.pinned ? 'Unpin' : 'Pin', Icon: item.pinned ? PinOff : Pin, run: () => void setPinned([item.id], !item.pinned) },
    { label: 'Move to...', Icon: FolderInput, run: () => useSheets.setState({ move: { ids: [item.id] } }) },
    { label: 'Share link', Icon: Share2, run: () => useSheets.setState({ share: item }) },
    { label: 'Duplicate', Icon: Copy, run: () => void duplicateItem(item) },
    item.kind === 'note' && { label: 'Download .md', Icon: Download, run: () => download(exportUrl(item.id)) },
    item.kind === 'file' && { label: 'Download', Icon: Download, run: () => download(fileUrl(item.id, true)) },
    { label: 'Move to trash', Icon: Trash2, danger: true, run: () => void trashItems([item.id]) },
  ]
}
