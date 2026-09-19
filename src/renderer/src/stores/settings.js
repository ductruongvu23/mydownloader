// src/renderer/src/stores/settings.js
import { defineStore } from 'pinia'
import i18n from '../i18n'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    downloadDir: '',
    language: 'vi',
    theme: 'dark',
    maxConcurrent: 5,
    threads: 32,
    speedLimit: 0,
    notifyOnComplete: true,
    bridgeEnabled: true,
    bridgePort: 6801,
    extensionToken: ''
  }),

  actions: {
    async init() {
      if (!window.api) return
      try {
        const settings = await window.api.getSettings()
        Object.assign(this, settings)
        this.applyTheme(this.theme)
        this.applyLanguage(this.language)
      } catch (err) {
        console.error('Không thể đọc cài đặt:', err)
      }
    },

    applyTheme(theme) {
      this.theme = theme
      const root = document.documentElement
      if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark')
        root.classList.add('dark')
      } else if (theme === 'light') {
        root.setAttribute('data-theme', 'light')
        root.classList.remove('dark')
      } else {
        // System auto
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.setAttribute('data-theme', isDark ? 'dark' : 'light')
        if (isDark) root.classList.add('dark')
        else root.classList.remove('dark')
      }
    },

    applyLanguage(lang) {
      this.language = lang
      i18n.global.locale.value = lang
    },

    async update(newSettings) {
      if (!window.api) return
      try {
        const updated = await window.api.updateSettings(newSettings)
        Object.assign(this, updated)
        if (newSettings.theme) this.applyTheme(newSettings.theme)
        if (newSettings.language) this.applyLanguage(newSettings.language)
        return true
      } catch (err) {
        console.error('Lưu cài đặt thất bại:', err)
        return false
      }
    },

    async chooseDirectory() {
      if (!window.api) return
      const dir = await window.api.selectDirectory()
      if (dir) {
        this.downloadDir = dir
        return dir
      }
      return null
    }
  }
})
