import { AUTO_POPOVER_ALL } from '../../constants'
import { MODEL_OFFICIAL_GROUP } from './copy-fallbacks'
import { readPrefs } from '../../core/prefs'
import { buildModelLabel, modelBrand } from './brand'
import { modelDescription } from './copy-lookup'
import { buildElement } from '../../shared/dom'
import { POPOVER_CHECK_SVG, POPOVER_CLOSE_DELAY, POPOVER_OPEN_DELAY, buildPopoverItem, createHoverIntent } from '../../shared/popover'
import type { HostContext } from '../../core/host'
import type { HostModelEntry, HostModelGroup } from '@dsh-claude-style/contracts/services'

/**
 * Model picker rows: the row builders, the provider folders of the first level
 * and the order they are listed in.
 *
 * Split out of the model picker's install (packages/client/src/features/model/model-picker.ts); this
 * fragment is the row half of that feature. createModelRows reaches the
 * feature's closure only through its options: ctx (the copy lookup),
 * pickModel(provider, modelId) (commit a row), closeIfAway (the picker's own
 * leave handling), and subProvider() / closeSub() / openSub(providerId) (the
 * second level's state). The two SVG strings, byModelId and the shared delays
 * are pure and stay at the fragment's top level.
 */
export const MODEL_CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>'

/**
 * The picker is two cards wide, and the second card only cancels a pending
 * close once the pointer is ON it — so the grace has to cover the journey from
 * a folder row, across the gap, onto that card. At the shared 100ms a slow
 * traverse ran it out and both cards folded up mid-journey.
 */
export const MODEL_CLOSE_DELAY = 150

/** Catalog order is whatever the provider happened to send; id order is scannable. */
export function byModelId(a: HostModelEntry, b: HostModelEntry) {
  const left = String(a.id)
  const right = String(b.id)
  return left < right ? -1 : left > right ? 1 : 0
}

export function createModelRows(options: {
  ctx: HostContext
  pickModel: (provider: string, modelId: string) => void
  closeIfAway: () => void
  subProvider: () => string | null
  closeSub: () => void
  openSub: (providerId: string) => void
  /** The peak rate meter's badge for one row, or null (features/peakrate). */
  rate: (provider: string, modelId: string) => HTMLElement | null
}) {
  const ctx = options.ctx
  const pickModel = options.pickModel
  const closeIfAway = options.closeIfAway
  const subProvider = options.subProvider
  const closeSub = options.closeSub
  const openSub = options.openSub
  const rate = options.rate

  /** One folder's dwell/grace: the same numbers the trigger and every other row use. */
  const folderHoverIntent = createHoverIntent(
    () => {
      const providerId = folderHoverProvider
      if (providerId !== null) openSub(providerId)
    },
    closeIfAway,
    POPOVER_OPEN_DELAY,
    MODEL_CLOSE_DELAY
  )
  let folderHoverProvider: string | null = null

  /**
   * One model row, the skeleton every level builds from: brand mark, name, an
   * optional description line, the peak rate meter and a check when the model is
   * in force. `onPick` is the whole difference between the rows — a list row
   * puts its model in force, the current seat's own row only folds the picker.
   *
   * Every row goes through here, the current seat's included: a row built
   * anywhere else is a row that can quietly lose whatever the others carry.
   */
  function buildModelRow(group: HostModelGroup, model: HostModelEntry, selected: boolean, withDescription: boolean, onPick: () => void) {
    // The shared row skeleton; the copy block keeps its own class, and
    // the vendor typography rides on the label inside it.
    const built = buildPopoverItem({ className: 'dsh-claude-model-option', role: 'menuitemradio', textClass: 'dsh-claude-model-copy', check: true })
    const item = built.row
    item.setAttribute('aria-checked', selected ? 'true' : 'false')
    const brand = modelBrand(model.id)
    // The brand id is the row's styling hook — it is what gives a vendor's rows
    // their own typography (see .dsh-claude-model-name in
    // features/model/model-picker.css). The vendor's mark is no longer drawn
    // here: it rides inside the label's lockup. The scheduler's attributeFilter
    // does not watch data-*, so this write cannot re-trigger a pass.
    if (brand) item.setAttribute('data-brand', brand)
    const copy = built.text
    // A model the host names with an empty string still reads as itself: the
    // row is picked by that id, so the label falls back to it.
    copy.appendChild(buildModelLabel(model.name || model.id, brand))
    // The description belongs to level 1 only: that list is the official
    // catalog, short enough that the line is what tells the models apart,
    // while "More models" is every provider's full catalog and reads better
    // as names alone. One line, in the shell's language — the copy document is
    // localized rather than stacked, so a row never carries two languages.
    const desc = withDescription ? modelDescription(ctx, group.id, model) : ''
    if (desc) copy.appendChild(buildElement('span', 'dsh-claude-model-desc', desc))
    // The peak rate meter rides in front of the check: the row is compared by
    // its rate before it is picked, and a model whose provider bills on no
    // clock carries no badge at all (packages/client/src/features/peakrate/, D54).
    const meter = rate(group.id, model.id)
    if (meter !== null) item.insertBefore(meter, built.check)
    built.check!.innerHTML = selected ? POPOVER_CHECK_SVG : ''
    item.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation()
      onPick()
    })
    return item
  }

  /** One selectable model row: picking it puts that model in force. */
  function buildModelOption(group: HostModelGroup, model: HostModelEntry, selected: boolean, withDescription: boolean) {
    return buildModelRow(group, model, selected, withDescription, () => { pickModel(group.id, model.id) })
  }

  /**
   * The model in force, as a row of its own for the case where level 1 lists no
   * group carrying it: the same row with its check on, and picking it only folds
   * the picker, because that model is already in force.
   */
  function buildCurrentOption(group: HostModelGroup, model: HostModelEntry) {
    return buildModelRow(group, model, true, true, () => { closeSub() })
  }

  /**
   * One provider, as a folder on the first level: its name, how many models it
   * carries, a check when one of them is in force, and a chevron. Hovering
   * opens that provider's models in the second card; a click toggles it, so a
   * pointer that never dwells can still drill in.
   */
  function buildProviderFolder(group: HostModelGroup, selected: boolean, open: boolean) {
    const cell = buildElement('button', 'dsh-claude-model-cell dsh-claude-model-folder')
    cell.type = 'button'
    cell.setAttribute('role', 'menuitem')
    cell.setAttribute('aria-haspopup', 'menu')
    cell.setAttribute('aria-checked', selected ? 'true' : 'false')
    if (open) cell.setAttribute('data-open', 'true')
    cell.appendChild(buildElement('span', 'dsh-claude-model-cell-label', group.name || group.id))
    cell.appendChild(buildElement('span', 'dsh-claude-model-cell-count', String(group.models.length)))
    const chevron = buildElement('span', 'dsh-claude-model-cell-chevron')
    chevron.innerHTML = MODEL_CHEVRON_SVG
    cell.appendChild(chevron)
    // The provider in force carries the same accent check every model row
    // uses, in the same slot: without a mark the folder only differs from the
    // rest by an attribute no reader sees.
    const check = buildElement('span', 'dsh-claude-popover-check')
    if (selected) check.innerHTML = POPOVER_CHECK_SVG
    cell.appendChild(check)
    cell.addEventListener('mouseenter', () => {
      folderHoverProvider = group.id
      if (readPrefs().autoPopover === AUTO_POPOVER_ALL) folderHoverIntent.scheduleOpen()
    })
    cell.addEventListener('mouseleave', () => {
      // A pointer that only crossed the folder must not drill in behind it.
      folderHoverIntent.cancel()
    })
    cell.addEventListener('click', e => {
      e.stopPropagation()
      if (subProvider() === group.id) closeSub()
      else openSub(group.id)
    })
    return cell
  }

  /**
   * The rule that separates one provider's folders from the next: the quick
   * providers sit above it, the rest below, so one quiet line carries the whole
   * jump. It is drawn only when there is something on both sides of it.
   */
  function buildProviderRule(name: string) {
    const rule = buildElement('div', 'dsh-claude-model-rule')
    if (name) rule.appendChild(buildElement('span', 'dsh-claude-model-rule-name', name))
    return rule
  }

  /**
   * The providers level 1 lists, in the order it lists them: the official
   * service first, then the quick providers the settings page picked, then
   * everything else. A provider with no models is not a folder at all.
   */
  function providerFolders(groups: HostModelGroup[]) {
    const folders: HostModelGroup[] = []
    const chosen = readPrefs().quickProviders
    for (let g0 = 0; g0 < groups.length; g0++) {
      if (groups[g0].id === MODEL_OFFICIAL_GROUP && groups[g0].models.length > 0) {
        folders.push(groups[g0])
        break
      }
    }
    for (let g2 = 0; g2 < groups.length; g2++) {
      if (!chosen.includes(groups[g2].id) || groups[g2].id === MODEL_OFFICIAL_GROUP || groups[g2].models.length === 0) continue
      folders.push(groups[g2])
    }
    for (let g4 = 0; g4 < groups.length; g4++) {
      if (folders.indexOf(groups[g4]) !== -1) continue
      if (groups[g4].models.length > 0) folders.push(groups[g4])
    }
    return folders
  }

  /**
   * How many of the folders are quick providers, which is where the rule
   * between the two halves goes: everything after that count sits below it.
   */
  function quickFolderCount(groups: HostModelGroup[]) {
    const chosen = readPrefs().quickProviders
    const folders = providerFolders(groups)
    let count = 0
    for (let i = 0; i < folders.length; i++) {
      if (folders[i].id === MODEL_OFFICIAL_GROUP || chosen.includes(folders[i].id)) count++
      else break
    }
    return count
  }

  return {
    buildProviderRule,
    buildProviderFolder,
    buildModelOption,
    buildCurrentOption,
    providerFolders,
    quickFolderCount
  }
}
