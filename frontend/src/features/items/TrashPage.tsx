import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { confirmAction } from '../../ui/dialogs'
import { timeAgo } from '../format'
import { itemIcon } from './ItemCard'
import { failed, refreshItems } from './actions'

export function TrashPage() {
  const { data } = useQuery({ queryKey: ['items', 'trash'], queryFn: () => api.items({ trashed: true, limit: 1000 }) })
  const items = data?.items ?? []
  const emptyAll = async () => {
    const ok = await confirmAction({ title: 'Empty the trash?', body: `${items.length} item${items.length === 1 ? '' : 's'} will be gone for good.`, action: 'Empty trash' })
    if (ok) await api.emptyTrash().then(refreshItems, failed)
  }
  const purge = async (id: string, title: string) => {
    if (await confirmAction({ title: `Delete ${title}?`, body: 'This cannot be undone.', action: 'Delete forever' })) await api.bulk([id], 'purge').then(refreshItems, failed)
  }
  return (
    <div className="page">
      <header className="page-head">
        <h1>Trash</h1>
        {items.length > 0 && <button type="button" className="btn btn-danger" onClick={() => void emptyAll()}><Trash2 size={16} aria-hidden="true" /> Empty trash</button>}
      </header>
      <p className="hint">Items here are deleted for good after 30 days. Links to them stop working while they are in the trash.</p>
      {data && items.length === 0 && <div className="empty"><p>The trash is empty.</p></div>}
      <ul className="rows">
        {items.map((item) => {
          const Icon = itemIcon(item)
          return (
            <li key={item.id}>
              <Icon size={18} aria-hidden="true" />
              <span className="rows-title">{item.title}</span>
              <span className="hint">{item.deleted_at && timeAgo(item.deleted_at)}</span>
              <button type="button" className="icon-btn" title="Restore" aria-label={`Restore ${item.title}`} onClick={() => void api.bulk([item.id], 'restore').then(refreshItems, failed)}><RotateCcw size={17} /></button>
              <button type="button" className="icon-btn" title="Delete forever" aria-label={`Delete ${item.title} forever`} onClick={() => void purge(item.id, item.title)}><Trash2 size={17} /></button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
