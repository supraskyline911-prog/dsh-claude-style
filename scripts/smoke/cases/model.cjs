'use strict'
const { check, basicChecks, same } = require('./_shared.cjs')

/** One row by the name its label carries. */
function byName(rows) {
  return (rows || []).reduce((all, row) => { all[row.name] = row; return all }, {})
}

module.exports = {
  /**
   * The model menu's folders, the model in force named under them, and the peak
   * rate meter every model row carries: an official model a profile claims, one
   * no profile claims, the seat's own row, and the same rows again in the
   * second card a folder opens.
   */
  'model-meter'(r) {
    basicChecks(r)
    const meter = r.modelMeter || {}
    const folders = meter.folders || []
    const levelOne = meter.levelOne || []
    const one = byName(levelOne)
    const two = byName(meter.levelTwo)
    check('level 1 lists one folder per provider, the official service first, each with a chevron and its model count',
      folders.length === 2 && folders[0].name === 'DeepSeek' && folders[0].count === '2' &&
        folders[1].name === 'Z.ai' && folders[1].count === '1' &&
        folders.every((folder) => folder.chevron === true),
      JSON.stringify(folders))
    check('the folder holding the model in force is the marked one',
      folders.length === 2 && folders[1].selected === true && folders[0].selected === false,
      JSON.stringify(folders.map((folder) => ({ name: folder.name, selected: folder.selected }))))
    check('the folders are drawn as one row each, all of the same height',
      folders.length === 2 && folders[0].height >= 28 && folders[0].height === folders[1].height,
      JSON.stringify(folders.map((folder) => folder.height)))
    check('level 1 carries no model row of its own: the models sit behind their folder',
      levelOne.length === 1 && one['GLM-5.3'] !== undefined,
      JSON.stringify(levelOne.map((row) => row.name)))
    check('the quick providers sit above the rule and the rest below it',
      folders.length === 2 && folders[0].name === 'DeepSeek' && (meter.rules || []).indexOf('All providers') !== -1,
      JSON.stringify({ folders: folders.map((folder) => folder.name), rules: meter.rules }))
    check('the model in force is named under the folders, behind a rule of its own',
      meter.currentRow !== null && meter.currentRow !== undefined && meter.currentRow.current === true && meter.currentRow.name === 'GLM-5.3' &&
        (meter.rules || []).length === 2 && meter.rules[1] === 'Current model',
      JSON.stringify({ rules: meter.rules, current: meter.currentRow === null || meter.currentRow === undefined ? null : meter.currentRow.name }))
    check('the named row carries the meter with the rate in force on it',
      meter.currentRow !== null && meter.currentRow !== undefined && meter.currentRow.meter !== null &&
        meter.currentRow.meter.period === 'campaign' && meter.currentRow.meter.value === '0.5×' && meter.currentRow.meter.icon,
      JSON.stringify(meter.currentRow === null || meter.currentRow === undefined ? null : meter.currentRow.meter))
    check('every meter stands immediately in front of its row\'s check, and names its judgement',
      levelOne.every((row) => row.meter === null || (row.meter.beforeCheck === true && row.meter.title !== null && row.meter.title !== '')),
      JSON.stringify(levelOne.map((row) => row.meter === null ? null : { beforeCheck: row.meter.beforeCheck, title: row.meter.title })))
    check('a folder opened by the reader is marked open',
      meter.openedMarked === true && meter.openedFolder === 'DeepSeek',
      JSON.stringify({ opened: meter.openedFolder, marked: meter.openedMarked }))
    check('the second card holds the models of the folder that was opened, headed by that provider',
      two['GLM-5.3'] === undefined && two['V4.1 Flash'] !== undefined && two['Kimi K3'] !== undefined && (meter.levelTwo || []).length === 2,
      JSON.stringify((meter.levelTwo || []).map((row) => row.name)))
    check('the second card carries the same meter on its rows',
      two['V4.1 Flash'] !== undefined && two['V4.1 Flash'].meter !== null &&
        (two['V4.1 Flash'].meter.period === 'peak' || two['V4.1 Flash'].meter.period === 'offPeak') &&
        (two['V4.1 Flash'].meter.value === '2×' || two['V4.1 Flash'].meter.value === '1×') &&
        /^· \d+[mhd]/.test(two['V4.1 Flash'].meter.countdown) &&
        two['V4.1 Flash'].meter.beforeCheck === true &&
        two['Kimi K3'] !== undefined && two['Kimi K3'].meter === null,
      JSON.stringify({ flash: two['V4.1 Flash'] === undefined ? null : two['V4.1 Flash'].meter, kimi: two['Kimi K3'] === undefined ? null : two['Kimi K3'].meter }))
    const listed = one['GLM-5.3']
    check('the named row is drawn as a row of the list: same height, padding, radius and layout',
      listed !== undefined && meter.currentRow !== undefined && same(meter.currentRow.box, listed.box),
      JSON.stringify({ current: meter.currentRow === null || meter.currentRow === undefined ? null : meter.currentRow.box, listed: listed === undefined ? null : listed.box }))
  },
}