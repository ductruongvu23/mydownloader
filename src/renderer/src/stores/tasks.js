// src/renderer/src/stores/tasks.js
import { defineStore } from 'pinia'

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    items: {},
    currentCategory: 'all', // 'all' | 'downloading' | 'waiting' | 'stopped' | 'done' | 'settings'
    searchQuery: ''
  }),

  getters: {
    allTasks: (state) => Object.values(state.items).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),

    downloadingTasks() {
      return this.allTasks.filter((t) => t.status === 'active')
    },

    waitingTasks() {
      return this.allTasks.filter((t) => t.status === 'waiting')
    },

    stoppedTasks() {
      return this.allTasks.filter((t) => ['paused', 'error'].includes(t.status))
    },

    doneTasks() {
      return this.allTasks.filter((t) => t.status === 'done')
    },

    filteredTasks() {
      let list = []
      switch (this.currentCategory) {
        case 'downloading':
          list = this.downloadingTasks
          break
        case 'waiting':
          list = this.waitingTasks
          break
        case 'stopped':
          list = this.stoppedTasks
          break
        case 'done':
          list = this.doneTasks
          break
        default:
          list = this.allTasks
      }

      if (this.searchQuery.trim()) {
        const q = this.searchQuery.toLowerCase().trim()
        list = list.filter((t) => (t.name || t.url || '').toLowerCase().includes(q))
      }
      return list
    },

    counts() {
      return {
        all: this.allTasks.length,
        downloading: this.downloadingTasks.length,
        waiting: this.waitingTasks.length,
        stopped: this.stoppedTasks.length,
        done: this.doneTasks.length
      }
    },

    totalSpeed() {
      return this.downloadingTasks.reduce((acc, t) => acc + (t.speed || 0), 0)
    }
  },

  actions: {
    async init() {
      if (!window.api) return
      try {
        const list = await window.api.list()
        for (const t of list) {
          this.items[t.id] = t
        }
      } catch (err) {
        console.error('Không thể tải danh sách tasks:', err)
      }

      window.api.onUpdate((task) => {
        this.items[task.id] = { ...(this.items[task.id] || {}), ...task }
      })

      window.api.onCleared((clearedIds) => {
        for (const id of clearedIds) {
          delete this.items[id]
        }
      })

      window.api.onRemoved((id) => {
        delete this.items[id]
      })
    },

    async addTasks(urls, opts) {
      if (!window.api) return []
      const added = await window.api.add(urls, opts)
      if (Array.isArray(added) && added.length > 0) {
        for (const t of added) {
          if (t && t.id) {
            this.items[t.id] = t
          }
        }
      }
      try {
        const fullList = await window.api.list()
        for (const t of fullList) {
          this.items[t.id] = t
        }
      } catch (e) {
        console.error('Lỗi nạp danh sách sau khi thêm:', e)
      }
      this.currentCategory = 'all'
      return added || []
    },

    async pause(id) {
      if (!window.api) return
      await window.api.pause(id)
    },

    async resume(id) {
      if (!window.api) return
      await window.api.resume(id)
    },

    async pauseAll() {
      if (!window.api) return
      await window.api.pauseAll()
    },

    async resumeAll() {
      if (!window.api) return
      await window.api.resumeAll()
    },

    async clearDone() {
      if (!window.api) return
      await window.api.clearDone()
    },

    async remove(id, deleteFile = false) {
      if (!window.api) return
      await window.api.remove(id, deleteFile)
      delete this.items[id]
    },

    async showInFolder(dest) {
      if (!window.api || !dest) return
      await window.api.showInFolder(dest)
    },

    async openFile(dest) {
      if (!window.api || !dest) return
      await window.api.openFile(dest)
    }
  }
})
