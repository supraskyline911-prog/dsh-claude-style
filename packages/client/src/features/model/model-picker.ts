import { AUTO_POPOVER_ALL } from '../../constants'
import { MODEL_ALL_PROVIDERS_LABEL, MODEL_CURRENT_LABEL, MODEL_EMPTY_LABEL, MODEL_FALLBACK_LABEL, MODEL_LOADING_LABEL, MODEL_TRIGGER_LABEL } from './copy-fallbacks'
import { activeLocale, copyLabel } from '../../core/i18n'
import { loadModelCopy } from '../../core/model-copy'
import { readPrefs } from '../../core/prefs'
import { createModelCatalog } from './catalog'
import { byModelId, createModelRows, MODEL_CLOSE_DELAY } from './rows'
import { buildElement, closestFrom, setAttributeIfChanged } from '../../shared/dom'
import { POPOVER_MARGIN, POPOVER_OPEN_DELAY, closeOtherPopovers, createHoverIntent, positionAnchoredPopover, registerPopover, removeStrayNodes, setMenuPopoverOpen, unregisterPopover } from '../../shared/popover'
import type { HostContext } from '../../core/host'
import type { FeatureHandle } from '../../core/scheduler'
import type { FeatureUi } from '../../core/feature'
import type manifest from './model-picker.manifest'
import type { CatalogProvider, ModelCatalog } from './catalog'

/** What the effort picker and the settings page read off the model picker (ui.model). */
export interface ModelHandle extends FeatureHandle {
  close(): void
  /** The host slot the seat lives in. */
  seat(): HTMLElement | null
  /** The skin's model trigger while it is in the document. */
  trigger(): HTMLButtonElement | null
  effort(): ReturnType<ModelCatalog['effort']>
  named(): boolean
  settled(): boolean
  pickEffort(effort: string | undefined): void
  providers(): CatalogProvider[]
  onProviders(listener: (providers: CatalogProvider[]) => void): () => void
  teardown(): void
}

export function install(ctx: HostContext, ui: FeatureUi<typeof manifest>) {
  /**
   * The host's model seat is a click-triggered two-pane menu (Model /
   * Effort rows drilling into their own lists). The skin replaces it with
   * a Claude-style picker: hovering the trigger opens the first level —
   * one folder per provider, a rule between the quick ones and the rest, and
   * the model in force named under the list; hovering a folder opens that
   * provider's models in the second card, beside the first.
   *
   * Data and submission ride the host's own per-session ModelDirectory
   * (`ctx.modelDirectories`), the same store the host's menu and the
   * /model command read — so the current selection, catalog and errors
   * stay in sync without scraping the DOM. The host's seat is hidden and
   * marked; a React swap re-marks it on the next pass.
   */
  let modelBtn: HTMLButtonElement | null = null
  let modelPop: HTMLElement | null = null
  let modelSubPop: HTMLElement | null = null
  let modelBody: HTMLElement | null = null
  let modelSubBody: HTMLElement | null = null
  /** The host slot the seat lives in; the effort picker anchors there too. */
  let modelSlot: HTMLElement | null = null
  /** The provider whose models the second card holds; null while it is closed. */
  let modelSubProvider: string | null = null
  /** Pending fold of level 2 while the pointer is still crossing level 1. */
  let subFoldTimer: ReturnType<typeof setTimeout> | null = null
  const modelHoverIntent = createHoverIntent(openModelPopover, closeModelIfAway, POPOVER_OPEN_DELAY, MODEL_CLOSE_DELAY)
  let modelBodySig = ''
  let modelSubSig = ''
  /**
   * The catalog half of the picker (packages/client/src/features/model/catalog.ts):
   * directory, snapshot, warm-up and the provider listeners. `schedule` is
   * the scheduler wake-up the directory's store subscription calls.
   */
  const modelCatalog = createModelCatalog({
      ctx,
      schedule() { if (ui.schedule) ui.schedule() }
  })
  /**
   * The row half of the picker (packages/client/src/features/model/rows.ts): the level-1
   * and level-2 builders. `pickModel` is this closure's own commit function
   * (a hoisted declaration); the rest is the second level's state.
   */
  const modelRows = createModelRows({
      ctx,
      pickModel,
      closeIfAway: closeModelIfAway,
      subProvider() { return modelSubProvider },
      closeSub: closeModelSub,
      openSub: openModelSub,
      /**
       * The peak rate meter is its own feature (packages/client/src/features/peakrate/):
       * it answers with a badge for the row, and with nothing at all for a
       * model whose provider bills on no clock.
       */
      rate(provider: string, modelId: string) {
        const peakrate = ui.peakrate
        if (peakrate === undefined) return null
        return peakrate.badge(provider, modelId)
      }
  })

  function cancelCloseModel() {
    modelHoverIntent.cancel()
    if (subFoldTimer !== null) {
      clearTimeout(subFoldTimer)
      subFoldTimer = null
    }
  }

  function scheduleCloseModel() {
    modelHoverIntent.scheduleClose()
  }

  /**
   * Where the pointer last was, tracked only while a card is up. The two cards
   * are separate boxes with a sliver of desktop between them, and a pointer
   * crossing that sliver has not left the picker — without this the grace
   * simply runs out mid-gap and both cards fold.
   */
  let pointer: { x: number, y: number } | null = null
  let pointerBound = false
  function trackPointer(event: MouseEvent) {
    pointer = { x: event.clientX, y: event.clientY }
  }
  function trackPointerWhileOpen() {
    const wanted = modelPop !== null && modelPop.getAttribute('data-open') === 'true'
    if (wanted === pointerBound) return
    pointerBound = wanted
    if (wanted) {
      document.addEventListener('mousemove', trackPointer, true)
    } else {
      document.removeEventListener('mousemove', trackPointer, true)
      pointer = null
    }
  }

  /** True while the tracked pointer sits within one card's box, with the same
   *  8px band of desktop around it that covers the sliver of gap between the
   *  two cards. */
  function pointerInCardBox(card: HTMLElement | null) {
    if (pointer === null || card === null) return false
    if (card.getAttribute('data-open') !== 'true') return false
    const box = card.getBoundingClientRect()
    return pointer.x >= box.left - 8 && pointer.x <= box.right + 8 &&
           pointer.y >= box.top - 8 && pointer.y <= box.bottom + 8
  }

  /** True while the pointer sits in either card, or in the gap between them. */
  function pointerInPicker() {
    return pointerInCardBox(modelPop) || pointerInCardBox(modelSubPop)
  }

  /** Close on leave, but treat the gap between the two cards as still inside. */
  function closeModelIfAway() {
    // With no tracked pointer there is nothing to test against — a click
    // opened the card, so the pointer never crossed the trigger and the
    // tracker never saw it. Folding on that reading closes a card the reader
    // is standing on; the leave that really means "away" comes later as a
    // mouseleave carrying a pointer of its own.
    if (pointer === null) return
    if (pointerInPicker()) {
      scheduleCloseModel()
      return
    }
    closeModelPopovers()
  }

  function closeModelPopovers() {
    cancelCloseModel()
    if (modelPop) setMenuPopoverOpen(modelPop, false)
    closeModelSub()
  }

  /**
   * Fold the second card on its own. The first card is the hover-intent host
   * and stays up: a folder row that hands its card back when the pointer is
   * only crossing level 1 would close the picker under the reader.
   */
  function closeModelSub() {
    if (subFoldTimer !== null) {
      clearTimeout(subFoldTimer)
      subFoldTimer = null
    }
    modelSubProvider = null
    if (modelSubPop) setMenuPopoverOpen(modelSubPop, false)
  }

  function openModelPopover() {
    cancelCloseModel()
    // One card at a time: the second level is this same choice and stays,
    // every other popover folds (the effort trigger sits beside this one, so
    // leaving its card up would stack two panels over one corner).
    closeOtherPopovers('model')
    const dir = modelCatalog.directory()
    // load() is async — the host itself guards with .catch(() => {}); a bare
    // try/catch cannot see its rejection.
    if (dir && typeof dir.load === 'function') {
      const pending = dir.load()
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => { /* the store's error surface covers a failure */ })
      }
    }
    closeModelSub()
    // A card opening repaints from scratch: its countdowns were drawn at
    // whatever minute it was last on screen, and a closed card is not part of
    // any signature (rateSignature).
    modelBodySig = ''
    renderModelBody()
    positionModelPopovers()
    if (modelPop) setMenuPopoverOpen(modelPop, true)
    // Pointer tracking binds on the NEXT pass: the position pass reads the
    // card's open attribute, so it runs while the card is still closed and
    // would leave tracking off. A leave that then arrives finds no pointer and
    // no card, reads as "away" and folds a card the reader is standing on.
    trackPointerWhileOpen()
  }

  /** Open one provider's models in the second card. */
  function openModelSub(providerId: string) {
    cancelCloseModel()
    modelSubProvider = providerId
    modelSubSig = ''
    renderModelSub()
    renderModelBody()
    // Open BEFORE placing: the placement pass reads the sub card only while
    // it is marked open, so positioning first would skip it and leave the
    // card at its previous position — every open has to place it fresh.
    if (modelSubPop) setMenuPopoverOpen(modelSubPop, true)
    positionModelPopovers()
  }

  function pickModel(provider: string, modelId: string) {
    const dir = modelCatalog.directory()
    if (dir === null) return
    // select() is async and rejects on a failed selection, which the host's
    // toast reports; the rejection is dropped the way the host's own seat
    // wrapper drops it.
    const pending = dir.select({ provider, model: modelId })
    if (pending && typeof pending.catch === 'function') pending.catch(() => {})
    // The card stays up while the pointer is still over it, so changing one
    // model and then another is a single gesture. A pick commits and the host
    // re-renders the seat under the pointer, so the reader has not moved:
    // folding here read as the picker closing by itself. Only a pointer that
    // has already left gets the close.
    if (pointerInPicker()) return
    closeModelPopovers()
  }

  /** Commit one reasoning level. The slider stays open for the next nudge. */
  function pickEffort(effort: string | undefined) {
    const dir = modelCatalog.directory()
    const snap = modelCatalog.snapshot()
    if (dir === null || !snap || snap.current === null) return
    const selection: { provider: string, model: string, reasoningEffort?: string } = { provider: snap.current.provider, model: snap.current.model }
    if (effort !== undefined) selection.reasoningEffort = effort
    // A rejected selection is reported by the host's toast (see pickModel).
    const pending = dir.select(selection)
    if (pending && typeof pending.catch === 'function') pending.catch(() => {})
  }

  /**
   * What the rows' rates depend on, in one value the render signatures carry.
   * The catalog is the meter feature's (its generation moves when one arrives),
   * and the minute only matters while a card is on screen — the countdown is
   * drawn to the minute, and a card that is down is repainted by the opening
   * pass anyway.
   */
  function rateSignature() {
    const peakrate = ui.peakrate
    if (peakrate === undefined) return ''
    const up = (modelPop !== null && modelPop.getAttribute('data-open') === 'true') ||
      (modelSubPop !== null && modelSubPop.getAttribute('data-open') === 'true')
    return up ? `${peakrate.epoch()}/${Math.floor(Date.now() / 60000)}` : `${peakrate.epoch()}`
  }

  /**
   * Level 1: one folder per provider, a rule between the quick ones and the
   * rest, and the model in force named under the list.
   */
  function renderModelBody() {
    if (!modelBody) return
    const snap = modelCatalog.snapshot()
    const status = snap ? snap.status : 'idle'
    const groups = (snap && snap.groups) || []
    const current = modelCatalog.current(snap)
    let sig = [status, activeLocale(), current ? `${current.group.id}/${current.model.id}` : '', modelSubProvider === null ? '' : `sub:${modelSubProvider}`, readPrefs().quickProviders.join(','), rateSignature()].join('|')
    for (let g = 0; g < groups.length; g++) sig += `;${groups[g].id}:${groups[g].models.length}`
    if (sig === modelBodySig) {
      return
    }
    modelBodySig = sig
    while (modelBody.firstChild) modelBody.removeChild(modelBody.firstChild)

    // A seat whose data is still in flight must not blank a picker that
    // already has a list. The host marks the directory `selecting` for the
    // WHOLE selectModel round-trip, and that round-trip runs for seconds on
    // providers whose adapters resolve over the network. Only a directory with
    // nothing to show yet falls back to the loading line.
    const seated = groups.length > 0 && current !== null
    if (!seated && (status === 'idle' || status === 'loading' || status === 'selecting')) {
      modelBody.appendChild(buildElement('div', 'dsh-claude-popover-status', copyLabel('loading', MODEL_LOADING_LABEL)))
    } else {
      const folders = modelRows.providerFolders(groups)
      if (folders.length === 0) {
        modelBody.appendChild(buildElement('div', 'dsh-claude-popover-status', copyLabel('empty', MODEL_EMPTY_LABEL)))
      } else {
        // The rule marks where the quick providers end. It needs something on
        // both sides: alone under the list or alone at the top it is a stray
        // line, so it is drawn only when it separates two halves.
        const quick = modelRows.quickFolderCount(groups)
        for (let f = 0; f < folders.length; f++) {
          if (f === quick && quick > 0 && quick < folders.length) {
            modelBody.appendChild(modelRows.buildProviderRule(copyLabel('allProvidersLabel', MODEL_ALL_PROVIDERS_LABEL)))
          }
          const folder = folders[f]
          const selected = current !== null && current.group.id === folder.id
          modelBody.appendChild(modelRows.buildProviderFolder(folder, selected, modelSubProvider === folder.id))
        }
        // The model in force is named under the folders, above the rule: it is
        // the seat the reader is on, and it carries the description and the
        // peak rate meter the folder rows do not have room for.
        if (current !== null) {
          modelBody.appendChild(modelRows.buildProviderRule(copyLabel('currentLabel', MODEL_CURRENT_LABEL)))
          modelBody.appendChild(modelRows.buildCurrentOption(current.group, current.model))
        }
      }
    }
  }

  /** Level 2: the models of the folder that is open, headed by its name. */
  function renderModelSub() {
    if (!modelSubBody) return
    const snap = modelCatalog.snapshot()
    const groups = (snap && snap.groups) || []
    const current = modelCatalog.current(snap)
    const group = groups.find(g => g.id === modelSubProvider) ?? null
    // The card holds one provider's models, so its signature is that provider
    // and the catalog counts — not level 1's list.
    let sig2 = `folder|${modelSubProvider === null ? '' : modelSubProvider}|${rateSignature()}`
    for (let g = 0; g < groups.length; g++) sig2 += `;${groups[g].id}:${groups[g].models.length}`
    if (current) sig2 += `#${current.group.id}/${current.model.id}`
    if (sig2 === modelSubSig) return
    modelSubSig = sig2
    while (modelSubBody.firstChild) modelSubBody.removeChild(modelSubBody.firstChild)
    if (group !== null && group.models.length > 0) {
      const groupSection = buildElement('div', 'dsh-claude-model-group-section')
      const groupRow = buildElement('div', 'dsh-claude-model-group-row')
      const groupLabel = buildElement('div', 'dsh-claude-model-group')
      // The group label is the provider's name alone: a mark there would repeat
      // what the rows below already carry inside their lockups.
      groupLabel.appendChild(buildElement('span', 'dsh-claude-model-group-name', group.name || group.id))
      groupRow.appendChild(groupLabel)
      groupSection.appendChild(groupRow)
      // A provider's models read in id order, so the list is scannable and stays
      // put between visits; the catalog's own order is whatever the provider
      // happened to send. Sorted on a copy — the snapshot belongs to the store.
      const groupModels = group.models.slice().sort(byModelId)
      for (let m = 0; m < groupModels.length; m++) {
        const selected = current !== null && current.group.id === group.id && current.model.id === groupModels[m].id
        groupSection.appendChild(modelRows.buildModelOption(group, groupModels[m], selected, false))
      }
      modelSubBody.appendChild(groupSection)
    }
    if (modelSubBody.firstChild === null) {
        modelSubBody.appendChild(buildElement('div', 'dsh-claude-popover-status', copyLabel('empty', MODEL_EMPTY_LABEL)))
    }
  }

  function positionModelPopovers() {
    // Pointer tracking follows the card's own open attribute, never the other
    // way round: the placement pass below reads that attribute to decide
    // whether the second card needs a spot, so it has to run first.
    trackPointerWhileOpen()
    if (!modelBtn || !modelPop) return
    const pos = positionAnchoredPopover(modelBtn, modelPop, { side: 'above', gap: 6 })
    if (modelSubPop && modelSubPop.getAttribute('data-open') === 'true') {
      const w2 = modelSubPop.offsetWidth
      const h2 = modelSubPop.offsetHeight
      const h1 = modelPop.offsetHeight
      // Beside the first level; flip to its left when the viewport is tight.
      let x2 = pos.x + modelPop.offsetWidth + 2
      if (x2 + w2 > window.innerWidth - POPOVER_MARGIN) x2 = Math.max(POPOVER_MARGIN, pos.x - 4 - w2)
      // Bottom-aligned with the first level; a level 2 TALLER than level 1
      // keeps its top instead, so it cannot push itself off the top edge.
      let y2 = pos.y + Math.max(0, h1 - h2)
      y2 = Math.max(POPOVER_MARGIN, Math.min(y2, window.innerHeight - h2 - POPOVER_MARGIN))
      modelSubPop.style.left = `${x2}px`
      modelSubPop.style.top = `${y2}px`
    }
  }

  function ensureModelChrome() {
    // Idempotence guard, not just a null check: the picker's own teardown
    // sweep, or a hot-reload generation's stray sweep, can REMOVE the
    // popover node while the closure still references it. With a null-only
    // check the reference stays non-null-but-detached and is never rebuilt
    // — the trigger then toggles a popover that is not in the document and
    // the picker silently loses its click effect. The account footer's
    // equivalent guard (footArea.contains) is the established pattern.
    // Rebuilding also re-points the body/footer children and resets the
    // render signatures so the next pass repaints into the fresh nodes.
    if (modelPop === null || modelPop.parentElement === null) {
      modelPop = document.createElement('div')
      modelPop.className = 'dsh-claude-popover-card dsh-claude-model-popover'
      setMenuPopoverOpen(modelPop, false)
      modelBody = document.createElement('div')
      modelBody.className = 'dsh-claude-popover-body'
      modelPop.appendChild(modelBody)
      modelPop.addEventListener('mouseenter', cancelCloseModel)
      // The second level belongs to the folder that opened it: the pointer
      // landing anywhere else on the first level folds it. Moving between two
      // folder rows never crosses the popover's boundary, so a mouseenter here
      // would never see it — the delegated mouseover does.
      modelPop.addEventListener('mouseover', e => {
        if (closestFrom(e.target, '.dsh-claude-model-cell')) {
          // A timer from crossing the bare card must not fold the submenu once
          // the pointer lands on the folder it belongs to.
          cancelCloseModel()
          return
        }
        if (modelSubPop === null || modelSubPop.getAttribute('data-open') !== 'true') return
        // Delayed, not immediate: the sub card sits BESIDE level 1, so a
        // pointer on its way from the folder to the sub crosses level 1's own
        // rows — folding on the spot made that journey impossible at any
        // speed. Folding now waits out the same grace, and stands down only
        // when the pointer has meanwhile reached the sub card itself.
        if (subFoldTimer !== null) clearTimeout(subFoldTimer)
        subFoldTimer = setTimeout(closeModelSub, MODEL_CLOSE_DELAY)
      })
      modelPop.addEventListener('mouseleave', scheduleCloseModel)
      document.body.appendChild(modelPop)
      modelBodySig = ''
    }
    if (modelSubPop === null || modelSubPop.parentElement === null) {
      modelSubPop = document.createElement('div')
      modelSubPop.className = 'dsh-claude-popover-card dsh-claude-model-popover dsh-claude-model-popover-sub'
      setMenuPopoverOpen(modelSubPop, false)
      modelSubBody = document.createElement('div')
      modelSubBody.className = 'dsh-claude-popover-body'
      modelSubPop.appendChild(modelSubBody)
      modelSubPop.addEventListener('mouseenter', cancelCloseModel)
      modelSubPop.addEventListener('mouseleave', scheduleCloseModel)
      document.body.appendChild(modelSubPop)
      modelSubSig = ''
    }
  }

  /**
   * Hand the host's own model seat and menu back: unmark the seat, remove the
   * skin's trigger and popovers, drop the catalog subscription.
   */
  function dropModelControl() {
    const allHosts = document.querySelectorAll('[data-dsh-claude-model-host]')
    for (let h = 0; h < allHosts.length; h++) {
      allHosts[h].removeAttribute('data-dsh-claude-model-host')
    }
    removeStrayNodes(document, '.dsh-claude-model-btn', [])
    modelBtn = null
    removeStrayNodes(document, '.dsh-claude-model-popover', [])
    modelPop = null
    modelSubPop = null
    modelBody = null
    modelSubBody = null
    modelSubProvider = null
    modelBodySig = ''
    modelSubSig = ''
    cancelCloseModel()
    modelCatalog.reset()
  }

  /** Build/refresh the trigger, its label and the popover rows. */
  function syncModelControl() {
    // Two ways to be off: the composer restyle does not apply to this page, or
    // the picker preference is off. Both hand the host's own model seat and
    // menu back, so both run the same sweep.
    if (!ui.composer!.isActive() || !readPrefs().modelPicker) {
      dropModelControl()
      return
    }

    // The copy document is fetched on first paint of the picker rather than
    // at install, so a session that never opens it never pays for it.
    loadModelCopy()
    modelCatalog.directory()
    modelCatalog.warm()
    const slot = document.querySelector<HTMLElement>('[data-slot="conversation.input.model"]')
    modelSlot = slot
    if (slot === null) return
    // Hide the host's own seat (React owns the node; re-mark on swap).
    // Idempotent against a torn-down-less reload, like the account footer:
    // client HMR drops the old fiber's disposals, so a previous generation's
    // trigger and popovers are still in the DOM while this fresh scope starts
    // from null. Sweep the strays, or the seat renders twice.
    removeStrayNodes(slot, '.dsh-claude-model-btn', [modelBtn])
    removeStrayNodes(document, 'body > .dsh-claude-model-popover', [modelPop, modelSubPop])
    const hostRoot = slot.firstElementChild
    if (hostRoot !== null) hostRoot.toggleAttribute('data-dsh-claude-model-host', true)
    if (modelBtn === null || modelBtn.parentElement !== slot) {
      if (modelBtn !== null && modelBtn.parentElement !== null) modelBtn.parentElement.removeChild(modelBtn)
      modelBtn = document.createElement('button')
      modelBtn.type = 'button'
      modelBtn.className = 'dsh-claude-model-btn'
      modelBtn.setAttribute('aria-haspopup', 'menu')
      modelBtn.innerHTML = '<span class="dsh-claude-model-btn-label"></span>'
      // Same contract as the account trigger: hover under the "All" scope,
      // click-only otherwise.
      modelBtn.addEventListener('mouseenter', () => {
        if (readPrefs().autoPopover === AUTO_POPOVER_ALL) modelHoverIntent.scheduleOpen()
      })
      modelBtn.addEventListener('mouseleave', () => {
        if (readPrefs().autoPopover === AUTO_POPOVER_ALL) scheduleCloseModel()
      })
      modelBtn.addEventListener('click', e => {
        e.stopPropagation()
        if (modelPop && modelPop.getAttribute('data-open') === 'true') closeModelPopovers()
        else openModelPopover()
      })
      slot.appendChild(modelBtn)
    }
    ensureModelChrome()

    const snap = modelCatalog.snapshot()
    const current = modelCatalog.current(snap)
    const groupsNow = (snap && snap.groups) || []
    const label = current ? current.model.name : copyLabel('fallbackLabel', MODEL_FALLBACK_LABEL)
    const labelEl = modelBtn.querySelector('.dsh-claude-model-btn-label')
    if (labelEl) {
      // Same-value guards: syncModelControl runs on every scheduler pass,
      // and an identical write still mutates the DOM (textContent replaces
      // the text node; setAttribute queues an attribute record — and
      // aria-label is in the observer's attributeFilter). Unguarded, each
      // pass feeds the observer that schedules the next pass, keeping one
      // full pass running every frame even at idle.
      if (labelEl.textContent !== label) labelEl.textContent = label
      // The dimmed tone means "no seat to name yet". A selection in flight
      // still names the model in force, so it keeps the normal tone — the
      // host can hold `selecting` for seconds (the effort slider commits
      // through that same RPC), and a greyed-out trigger for that long
      // reads as broken rather than busy.
      const unsettled = !!(snap && (snap.status === 'loading' || snap.status === 'idle' || snap.status === 'selecting')) && !(groupsNow.length > 0 && current !== null)
      labelEl.classList.toggle('dsh-claude-model-btn-loading', unsettled)
    }
    // The level is NOT part of this trigger any more: it has its own button
    // beside it (packages/client/src/features/effort/effort-picker.ts). A stale "· High" span from
    // an older generation is swept rather than reused.
    const staleEffortEl = modelBtn.querySelector('.dsh-claude-model-btn-effort')
    if (staleEffortEl !== null) staleEffortEl.remove()
    const triggerAria = copyLabel('triggerLabel', MODEL_TRIGGER_LABEL, { model: label })
    setAttributeIfChanged(modelBtn, 'aria-label', triggerAria)
    modelBtn.disabled = false

    renderModelBody()
    if (modelSubPop && modelSubPop.getAttribute('data-open') === 'true') {
      renderModelSub()
      positionModelPopovers()
    } else if (modelPop && modelPop.getAttribute('data-open') === 'true') {
      positionModelPopovers()
    }
  }


  // The picker takes part in the shared popover rule (shared/popover.ts): one
  // entry for BOTH levels, so opening the More-models card never folds the
  // card that carries it.
  registerPopover('model', closeModelPopovers)

  ui.model = {
    sync: syncModelControl,
    /**
     * Close both levels of the picker. The scheduler calls this for every
     * dismiss reason ('outside', 'escape', 'composer') and the picker acts
     * on all of them, so the reason is ignored; other features (the effort
     * picker) call it with none.
     */
    close() { closeModelPopovers() },
    /**
     * What the effort picker (a separate fragment that owns the level's
     * trigger and card) reads from this one: the seat slot, the model
     * trigger it sits beside, the effort descriptor and the commit call.
     * `effort()` re-reads the catalog every call, so a level the host echoes
     * back lands on the knob without either fragment pushing it.
     */
    seat() { return modelSlot },
    /** The skin's model trigger while it is in the document, else null. */
    trigger() { return modelBtn !== null && modelBtn.isConnected ? modelBtn : null },
    effort() { return modelCatalog.effort(modelCatalog.snapshot()) },
    /**
     * Whether the catalog can match the current selection to a group and
     * model. FALSE is "cannot name the seat" (the snapshot is still arriving,
     * or the provider group is not in it), which is not the same as "the seat
     * has no levels".
     */
    named() { return modelCatalog.current(modelCatalog.snapshot()) !== null },
    /**
     * Whether the catalog is currently able to name the seat. FALSE means
     * "in flight": the host re-enumerates the whole directory for seconds
     * after every selection, and during that window the snapshot can have no
     * groups, no current seat and no reasoning metadata. Readers must not
     * read that as "this model has no levels" — the model card learned this
     * the hard way (it blanked its list on every pick), and the effort card
     * would take its trigger away mid-selection.
     */
    settled() {
      const snap = modelCatalog.snapshot()
      if (!snap) return true
      const inFlight = snap.status === 'loading' || snap.status === 'idle' || snap.status === 'selecting'
      const groups = snap.groups || []
      return !inFlight || (groups.length > 0 && modelCatalog.current(snap) !== null)
    },
    pickEffort,
    owns(target: Node) {
      if (!target) return false
      return (modelBtn !== null && modelBtn.contains(target)) ||
             (modelPop !== null && modelPop.contains(target)) ||
             (modelSubPop !== null && modelSubPop.contains(target))
    },
    reposition: positionModelPopovers,
    providers: modelCatalog.providers,
    onProviders: modelCatalog.onProviders,
    /**
     * A copy source changed: drop the render signatures so the next pass
     * repaints the rows in the new language.
     */
    onCopyChange() {
      modelBodySig = ''
      modelSubSig = ''
    },
    // Removes the skin's DOM too: a feature switched off mid-session (see
    // packages/client/src/entry.ts) keeps the stylesheet around it, so the seat has to be
    // handed back here rather than by the stylesheet going away.
    teardown() {
      dropModelControl()
      modelCatalog.resetWarm()
      modelSlot = null
      unregisterPopover('model')
    }
  }

  return ui.model.teardown
}
