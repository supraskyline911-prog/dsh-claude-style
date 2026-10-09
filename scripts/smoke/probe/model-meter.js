/**
 * The model menu and the peak rate meter on its rows: the host's model seat is
 * put on the page, the picker's trigger is pressed, and both levels are read
 * back — the provider folders of the first level, then the models of the folder
 * that is opened, with what each row carries and where the meter stands in it.
 *
 * The page's model directory puts the model in force in a provider the quick
 * list does not name, so level 1 lists that provider as a folder of its own and
 * names the model in force under the list.
 */
(function () {
  var probe = window.__dshSmokeProbe
  var sleep = probe.sleep
  var r = probe.report

  probe.step(async function () {
    await probe.onlyFor(['model-meter'], async function () {
      // The host's own model seat, the way ui-conversation renders it. It lands
      // after boot, so the skin's next pass is what builds its trigger in it.
      var card = document.createElement('div')
      card.setAttribute('data-composer-card', '')
      card.innerHTML = '<div data-slot="conversation.input.model" style="display:contents">' +
        '<div class="_m_root_1"><button type="button" class="_m_trigger_1">GLM-5.3</button></div></div>'
      document.body.appendChild(card)
      await sleep(400)

      /** Every model row one card holds, with the meter's own place in it. */
      var readRows = function (card) {
        var rows = []
        if (card === null) return rows
        var options = card.querySelectorAll('.dsh-claude-model-option')
        for (var i = 0; i < options.length; i++) {
          var option = options[i]
          var meter = option.querySelector('.dsh-claude-peakrate')
          var check = option.querySelector('.dsh-claude-popover-check')
          var name = option.querySelector('.dsh-claude-model-name')
          var value = meter === null ? null : meter.querySelector('.dsh-claude-peakrate-value')
          var countdown = meter === null ? null : meter.querySelector('.dsh-claude-peakrate-countdown')
          var box = option.getBoundingClientRect()
          var style = getComputedStyle(option)
          rows.push({
            name: name === null ? '' : name.textContent,
            current: option.getAttribute('aria-checked') === 'true',
            // The shape every row shares: a row built apart from the others
            // shows up here before it is visible as a difference.
            box: {
              height: Math.round(box.height),
              padding: style.paddingLeft + ' ' + style.paddingRight,
              radius: style.borderRadius,
              display: style.display,
            },
            meter: meter === null ? null : {
              period: meter.getAttribute('data-period'),
              value: value === null ? '' : value.textContent,
              countdown: countdown === null ? '' : countdown.textContent,
              beforeCheck: meter.nextElementSibling === check,
              title: meter.getAttribute('title'),
              icon: meter.querySelector('svg') !== null,
            },
          })
        }
        return rows
      }

      /** Every provider folder level 1 holds, with the mark on the one in use. */
      var readFolders = function (card) {
        var folders = []
        if (card === null) return folders
        var cells = card.querySelectorAll('.dsh-claude-model-folder')
        for (var i = 0; i < cells.length; i++) {
          var label = cells[i].querySelector('.dsh-claude-model-cell-label')
          var count = cells[i].querySelector('.dsh-claude-model-cell-count')
          folders.push({
            name: label === null ? '' : label.textContent,
            count: count === null ? '' : count.textContent,
            selected: cells[i].getAttribute('aria-checked') === 'true',
            open: cells[i].getAttribute('data-open') === 'true',
            chevron: cells[i].querySelector('.dsh-claude-model-cell-chevron svg') !== null,
            height: Math.round(cells[i].getBoundingClientRect().height),
          })
        }
        return folders
      }

      var trigger = document.querySelector('.dsh-claude-model-btn')
      if (trigger !== null) trigger.click()
      await sleep(400)
      var firstCard = document.querySelector('.dsh-claude-model-popover:not(.dsh-claude-model-popover-sub)')
      var levelOne = readRows(firstCard)

      // The rule above the model in force, named under the folders.
      var rules = []
      if (firstCard !== null) {
        var named = firstCard.querySelectorAll('.dsh-claude-model-rule')
        for (var n = 0; n < named.length; n++) {
          rules.push(named[n].textContent.trim())
        }
      }

      // The second card belongs to the folder: a click on a folder opens that
      // provider's models beside the first level. The official service is the
      // one opened, so the card holds a model a profile claims and one no
      // profile claims.
      var cells = firstCard === null ? [] : firstCard.querySelectorAll('.dsh-claude-model-folder')
      var openedName = null
      if (cells.length > 0) {
        var label = cells[0].querySelector('.dsh-claude-model-cell-label')
        openedName = label === null ? null : label.textContent
        cells[0].click()
      }
      await sleep(300)

      // The folders are read back after the open: opening repaints level 1, so
      // the node that was clicked is no longer the one on screen.
      r.modelMeter = {
        trigger: trigger !== null,
        folders: readFolders(document.querySelector('.dsh-claude-model-popover:not(.dsh-claude-model-popover-sub)')),
        rules: rules,
        levelOne: levelOne,
        // The last row of level 1 is the model in force, named under the list.
        currentRow: levelOne.length === 0 ? null : levelOne[levelOne.length - 1],
        openedFolder: openedName,
        openedMarked: (function () {
          var after = readFolders(document.querySelector('.dsh-claude-model-popover:not(.dsh-claude-model-popover-sub)'))
          for (var i = 0; i < after.length; i++) {
            if (after[i].name === openedName && after[i].open === true) return true
          }
          return false
        })(),
        levelTwo: readRows(document.querySelector('.dsh-claude-model-popover-sub')),
      }
      card.remove()
    })
  })
})()