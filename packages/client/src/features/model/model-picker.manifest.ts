import type { FeatureManifest } from '../../core/feature'

export default {
  id: 'model',
  order: 80,
  reads: ['composer', 'peakrate'],
  contracts: [],
  pref: 'modelPicker',
  stylesheets: [{ file: 'model-picker.css', rank: 260 }],
  switchRow: {
    tab: 'composer',
    rank: 30,
    title: { key: 'pickerTitle', fallback: 'Redraw the model picker' },
    desc: { key: 'pickerDesc', fallback: 'Replace the composer\'s model menu with the two-level Claude-style menu. Off restores the host\'s model menu.' },
  },
  cases: ['brand', 'composer', 'settings', 'sync-fault', 'model-meter'],
  description: {
    zh: {
      title: '模型选择器',
      text: '输入区的模型菜单换成文件夹式的两级卡片：第一级每个供应商一个文件夹，带模型数量与当前选中标记，悬停展开；第二级是该供应商的模型，每个带厂商标志与一句说明。',
    },
    en: {
      title: 'Model picker',
      text: 'The composer\'s model menu becomes a two-level card of folders: the first level is one folder per provider, with its model count and a mark on the one in use, and hovering a folder opens its models in the second card beside it, each with its vendor mark and a line of description.',
    },
  },
} satisfies FeatureManifest
