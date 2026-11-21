import type { useHeaderObservations } from '#/header/useHeaderObservations'
import { Button, Small } from '#/components/ui'

type Check = ReturnType<typeof useHeaderObservations>['check']

/** Runs one fresh connection check; while it runs, a second press sends nothing. */
export function CheckConnectionButton({
  check,
  label = 'Check connection now',
}: {
  check: Check
  label?: string
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-disabled={check.isPending || undefined}
        onClick={() => {
          if (!check.isPending) {
            check.mutate()
          }
        }}
      >
        {check.isPending ? 'Checking…' : label}
      </Button>
      {check.isError && <Small role="status">The check didn't reach the server. Try again.</Small>}
    </>
  )
}
