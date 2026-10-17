import { useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  clearMerchantLabel,
  renameObligation,
  saveMerchantLabel,
} from '@/lib/api'

export function MerchantDisplay({
  name,
  rawMerchant,
}: {
  name: string
  rawMerchant: string
}) {
  return (
    <>
      <bdi dir="auto">{name}</bdi>
      {rawMerchant.trim() !== name.trim() && (
        <span className="block text-xs font-normal text-muted-foreground">
          <bdi dir="auto">{rawMerchant}</bdi>
        </span>
      )}
    </>
  )
}

export const merchantNamesChanged = 'spendwise:merchant-names-changed'

/** One editor for bank merchant labels and explicit obligation names. */
export default function MerchantName({
  name,
  rawMerchant,
  obligationId,
  preview = false,
  disabled = false,
}: {
  name: string
  rawMerchant?: string
  obligationId?: string
  preview?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(name)
  const [all, setAll] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const canEdit = !!(rawMerchant || obligationId)
  async function save(clear = false) {
    setBusy(true)
    setError('')
    // Save the obligation first: a retry remains safe if the merchant request fails.
    if (obligationId && !clear) {
      const result = await renameObligation(obligationId, label.trim(), preview)
      if (result.isErr()) {
        setError('Could not save the obligation name. Please try again.')
        setBusy(false)
        return
      }
    }
    if (rawMerchant && (clear || !obligationId || all)) {
      const result = await (clear
        ? clearMerchantLabel(rawMerchant, preview)
        : saveMerchantLabel(rawMerchant, label.trim(), preview))
      if (result.isErr()) {
        setError(
          obligationId && !clear
            ? 'Obligation name saved. Could not save the merchant label; please try again.'
            : 'Could not save the merchant label. Please try again.',
        )
        setBusy(false)
        return
      }
    }
    setBusy(false)
    setOpen(false)
    window.dispatchEvent(new Event(merchantNamesChanged))
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (busy) return
        setOpen(value)
        if (value) {
          setLabel(name)
          setAll(true)
          setError('')
        }
      }}
    >
      {canEdit ? (
        <Dialog.Trigger
          disabled={disabled}
          className="flex min-h-11 min-w-11 max-w-full items-center gap-2 rounded-md text-start text-sm font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          aria-label={`${obligationId ? 'Rename obligation' : 'Rename merchant'} ${name}`}
        >
          <bdi dir="auto" className="min-w-0 break-words">
            {name}
          </bdi>
          <Pencil
            size={13}
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Dialog.Trigger>
      ) : (
        <p className="text-start text-sm font-medium">
          <bdi dir="auto">{name}</bdi>
        </p>
      )}
      {rawMerchant && rawMerchant.trim() !== name.trim() && (
        <p className="text-start text-xs font-normal break-words text-muted-foreground">
          <bdi dir="auto">{rawMerchant}</bdi>
        </p>
      )}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          initialFocus={input}
          className="home-theme fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl border border-border bg-background p-5 pb-[max(24px,env(safe-area-inset-bottom))] text-foreground shadow-2xl outline-none"
          dir="ltr"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="text-xl font-semibold">
              {obligationId ? 'Rename obligation' : 'Rename merchant'}
            </Dialog.Title>
            <Dialog.Close
              disabled={busy}
              render={
                <Button variant="ghost" size="icon" className="size-11" />
              }
              aria-label="Close rename"
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-5 text-sm text-muted-foreground">
            {rawMerchant ? (
              <>
                Bank name: <bdi dir="auto">{rawMerchant}</bdi>
              </>
            ) : (
              'This name applies only to this obligation.'
            )}
          </Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="space-y-4"
          >
            <label className="block space-y-2 text-sm font-medium">
              Label
              <Input
                ref={input}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={160}
                required
                disabled={busy}
                dir="auto"
                className="mt-2 h-12 text-base"
              />
            </label>
            {obligationId && rawMerchant ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => setAll(e.target.checked)}
                  disabled={busy}
                  className="size-5 shrink-0 accent-current"
                />
                Use this name for all transactions from this merchant
              </label>
            ) : (
              rawMerchant && (
                <p className="text-sm text-muted-foreground">
                  Applies to past and future transactions from this merchant.
                </p>
              )
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || !label.trim()}
              className="min-h-12 w-full"
            >
              {busy ? 'Saving…' : 'Save name'}
            </Button>
            {rawMerchant && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void save(true)}
                className="min-h-11 w-full"
              >
                Clear merchant label
              </Button>
            )}
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
