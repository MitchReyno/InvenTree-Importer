import { Switch } from '#/components/ui'
import { useMastheadMotion } from '#/theme/masthead-motion'

/** Stops or starts the masthead's electronics on this device; the masthead style is unchanged. */
export function MastheadMotionSwitch() {
  const { motion, choose } = useMastheadMotion()

  return (
    <Switch
      label="Animate the electronics"
      checked={motion === 'on'}
      onChange={(checked) => choose(checked ? 'on' : 'off')}
    />
  )
}
