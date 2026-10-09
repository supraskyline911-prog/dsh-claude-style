import type { FeatureManifest } from '../../core/feature'

export default {
  id: 'quickProviders',
  order: 110,
  reads: ['model'],
  contracts: [],
  ungated: '模型选择器的设置项，不在界面上出现',
  stylesheets: [],
  cases: ['settings'],
  description: {
    zh: {
      title: '快捷供应商',
      text: '设置页里挑选哪些供应商的文件夹排在模型选择器第一级的前面；目录里已经没有的供应商标成「已移除」，可以取消勾选。',
    },
    en: {
      title: 'Quick providers',
      text: 'The settings page picks which providers\' folders lead the model picker\'s first level; a provider gone from the catalog is marked Removed and can be unchecked.',
    },
  },
} satisfies FeatureManifest
