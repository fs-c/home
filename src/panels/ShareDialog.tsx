import { useEffect, useState } from 'react'
import { inviteLink, type SyncStatus } from '../sync/useSync'
import type { SyncState } from '../sync/engine'
import { Button, inputClass } from './ui'

const STATUS_LABEL: Record<SyncStatus, string> = {
  off: 'Not shared',
  connecting: 'Connecting…',
  online: 'Up to date',
  offline: 'Offline – changes will sync when you reconnect',
  denied: 'This invite is no longer valid for this home',
}

/** Starts, shows and stops sharing. Anyone with the invite link can view and edit. */
export function ShareDialog({
  state, status, onStart, onStop, onClose,
}: {
  state: SyncState | null
  status: SyncStatus
  onStart: () => void
  onStop: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const link = state ? inviteLink(state) : ''
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my Home Hub', url: link })
        return
      } catch {
        // Cancelled or unsupported: fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The field is selectable as a last resort.
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:items-center"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id="share-title" className="text-lg font-semibold">Share this home</h2>
        {state ? (
          <>
            <p className="mt-1 text-sm text-stone-500">
              Anyone with this link can see and edit everything shared here, so only send it to people you trust.
              Floor plan images stay on the device that uploaded them.
            </p>
            <input readOnly value={link} onFocus={(e) => e.target.select()} className={`mt-3 w-full ${inputClass}`} />
            <p className="mt-2 text-sm text-stone-600">{STATUS_LABEL[status]}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button variant="danger" onClick={onStop}>Stop sharing on this device</Button>
              <Button variant="primary" onClick={() => void share()}>{copied ? 'Copied!' : 'Send invite link'}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-stone-500">
              Share your rooms, TODOs and notes with the people you live with. Changes show up for everyone, and
              keep working offline.
            </p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose}>Not now</Button>
              <Button variant="primary" onClick={onStart}>Start sharing</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
