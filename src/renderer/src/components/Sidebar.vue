<template>
  <aside class="sidebar">
    <!-- Logo -->
    <div class="logo-area">
      <div class="logo-icon">
        <el-icon :size="20"><Download /></el-icon>
      </div>
      <div class="logo-text-wrap">
        <span class="logo-text">MyDownloader</span>
        <span class="logo-version">v1.0.1</span>
      </div>
    </div>

    <!-- Nav -->
    <nav class="nav-menu">
      <button
        v-for="item in navItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: tasksStore.currentCategory === item.id }"
        @click="tasksStore.currentCategory = item.id"
      >
        <div class="item-icon-wrap" :class="{ spin: item.id === 'downloading' && tasksStore.counts.downloading > 0 }">
          <el-icon :size="16">
            <component :is="item.icon" />
          </el-icon>
        </div>
        <span class="item-title">{{ t(item.label) }}</span>
        <span v-if="item.badge > 0" class="badge" :class="item.badgeType">
          {{ item.badge > 99 ? '99+' : item.badge }}
        </span>
      </button>
    </nav>

    <!-- Speed indicator mini -->
    <div v-if="tasksStore.totalSpeed > 0" class="speed-mini">
      <div class="speed-mini-bar">
        <div class="speed-mini-fill" :style="{ width: speedBarWidth }"></div>
      </div>
      <span class="speed-mini-text">⬇ {{ formatSpeedShort(tasksStore.totalSpeed) }}</span>
    </div>

    <!-- Footer -->
    <div class="sidebar-footer">
      <button
        class="nav-item settings-btn"
        :class="{ active: tasksStore.currentCategory === 'settings' }"
        @click="tasksStore.currentCategory = 'settings'"
      >
        <div class="item-icon-wrap">
          <el-icon :size="16"><Setting /></el-icon>
        </div>
        <span class="item-title">{{ t('app.settings') }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '../stores/tasks'

const { t } = useI18n()
const tasksStore = useTasksStore()

const navItems = computed(() => [
  { id: 'all', label: 'app.all', icon: 'Files', badge: tasksStore.counts.all, badgeType: 'neutral' },
  { id: 'downloading', label: 'app.downloading', icon: 'Loading', badge: tasksStore.counts.downloading, badgeType: 'primary' },
  { id: 'waiting', label: 'app.waiting', icon: 'Clock', badge: tasksStore.counts.waiting, badgeType: 'warning' },
  { id: 'stopped', label: 'app.stopped', icon: 'VideoPause', badge: tasksStore.counts.stopped, badgeType: 'danger' },
  { id: 'done', label: 'app.done', icon: 'CircleCheck', badge: tasksStore.counts.done, badgeType: 'success' }
])

// Max speed reference: 300 MB/s
const speedBarWidth = computed(() => {
  const pct = Math.min(100, (tasksStore.totalSpeed / (300 * 1024 * 1024)) * 100)
  return `${pct}%`
})

function formatSpeedShort(bps) {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
}
</script>

<style scoped>
.sidebar {
  width: 210px;
  height: 100%;
  background: linear-gradient(180deg, #0d1220 0%, #0a101c 100%);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  flex-shrink: 0;
  position: relative;
}

.sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 1px;
  height: 100%;
  background: linear-gradient(180deg, transparent, rgba(56, 189, 248, 0.15) 50%, transparent);
  pointer-events: none;
}

/* Logo */
.logo-area {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 18px 8px;
}

.logo-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 4px 14px rgba(56, 189, 248, 0.35);
  flex-shrink: 0;
  animation: pulse-glow 3s ease-in-out infinite;
}

.logo-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.logo-text {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: var(--text-primary);
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.logo-version {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

/* Nav */
.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
  width: 100%;
  position: relative;
  overflow: hidden;
}

.nav-item::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--accent-gradient);
  opacity: 0;
  border-radius: 10px;
  transition: opacity var(--transition-fast);
}

.nav-item:hover {
  background-color: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
}

.nav-item.active {
  background: rgba(56, 189, 248, 0.1);
  color: #fff;
  font-weight: 600;
  border: 1px solid rgba(56, 189, 248, 0.2);
}

.nav-item.active .item-icon-wrap {
  color: var(--accent-color);
}

.item-icon-wrap {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  flex-shrink: 0;
  transition: all var(--transition-fast);
  background: rgba(255, 255, 255, 0.04);
}

.nav-item.active .item-icon-wrap {
  background: rgba(56, 189, 248, 0.15);
}

.spin {
  animation: spin-slow 2s linear infinite;
}

.item-title {
  flex: 1;
  font-size: 13px;
}

/* Badges */
.badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.badge.neutral {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.badge.primary {
  background: var(--accent-color);
  color: #fff;
  box-shadow: 0 2px 8px rgba(56, 189, 248, 0.4);
}

.badge.warning {
  background: var(--warning-color);
  color: #000;
}

.badge.danger {
  background: var(--danger-color);
  color: #fff;
}

.badge.success {
  background: var(--success-color);
  color: #fff;
}

/* Speed mini widget */
.speed-mini {
  margin: 10px 4px;
  padding: 8px 10px;
  background: rgba(56, 189, 248, 0.06);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.speed-mini-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.speed-mini-fill {
  height: 100%;
  background: var(--accent-gradient);
  border-radius: 2px;
  transition: width 0.5s ease;
}

.speed-mini-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-color);
  text-align: center;
}

/* Footer */
.sidebar-footer {
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}
</style>
