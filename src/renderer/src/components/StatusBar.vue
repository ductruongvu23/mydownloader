<template>
  <footer class="status-bar">
    <div class="status-left">
      <div class="live-dot" :class="{ active: tasksStore.totalSpeed > 0 }"></div>
      <span class="speed-label">Tổng tốc độ:</span>
      <span class="speed-value" :class="{ 'high-speed': tasksStore.totalSpeed > 50 * 1024 * 1024 }">
        {{ formatSpeed(tasksStore.totalSpeed) }}
      </span>
      <!-- Mini speed bar -->
      <div v-if="tasksStore.totalSpeed > 0" class="mini-speed-bar">
        <div class="mini-speed-fill" :style="{ width: speedPct + '%' }"></div>
      </div>
    </div>

    <div class="status-center">
      <span v-if="tasksStore.counts.downloading > 0" class="stat-chip active">
        <span class="chip-dot blue"></span>
        {{ tasksStore.counts.downloading }} đang tải
      </span>
      <span v-if="tasksStore.counts.waiting > 0" class="stat-chip waiting">
        <span class="chip-dot yellow"></span>
        {{ tasksStore.counts.waiting }} chờ
      </span>
      <span v-if="tasksStore.counts.done > 0" class="stat-chip done">
        <span class="chip-dot green"></span>
        {{ tasksStore.counts.done }} xong
      </span>
    </div>

    <div class="status-right">
      <span class="limit-badge">
        <el-icon :size="11"><Setting /></el-icon>
        Giới hạn: {{ settingsStore.speedLimit > 0 ? formatSpeed(settingsStore.speedLimit) : '∞' }}
      </span>
    </div>
  </footer>
</template>

<script setup>
import { computed } from 'vue'
import { useTasksStore } from '../stores/tasks'
import { useSettingsStore } from '../stores/settings'

const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

// Max reference: 500 MB/s
const speedPct = computed(() => Math.min(100, (tasksStore.totalSpeed / (500 * 1024 * 1024)) * 100))

function formatSpeed(bps) {
  if (!bps || bps <= 0) return '0 KB/s'
  if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`
  return `${(bps / 1024).toFixed(1)} KB/s`
}
</script>

<style scoped>
.status-bar {
  height: 34px;
  background: linear-gradient(90deg, #0a101c 0%, #0d1220 100%);
  border-top: 1px solid var(--border-color);
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-secondary);
  flex-shrink: 0;
  gap: 16px;
}

/* Live dot */
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.3s;
}
.live-dot.active {
  background: var(--success-color);
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.6);
  animation: live-pulse 1.6s ease-in-out infinite;
}
@keyframes live-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
  50% { transform: scale(1.15); box-shadow: 0 0 0 4px rgba(52, 211, 153, 0); }
}

/* Left */
.status-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 200px;
}
.speed-label { color: var(--text-muted); font-weight: 500; }
.speed-value {
  color: var(--accent-color);
  font-weight: 700;
  font-size: 12px;
  transition: color 0.3s;
  font-variant-numeric: tabular-nums;
}
.speed-value.high-speed {
  color: #34d399;
  text-shadow: 0 0 10px rgba(52, 211, 153, 0.4);
}
.mini-speed-bar {
  width: 60px;
  height: 3px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}
.mini-speed-fill {
  height: 100%;
  background: var(--accent-gradient);
  border-radius: 2px;
  transition: width 0.5s ease;
}

/* Center chips */
.status-center {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: center;
}
.stat-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 11px;
}
.stat-chip.active { background: rgba(56,189,248,0.1); color: var(--accent-color); }
.stat-chip.waiting { background: rgba(251,191,36,0.1); color: var(--warning-color); }
.stat-chip.done { background: rgba(52,211,153,0.1); color: var(--success-color); }
.chip-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.chip-dot.blue { background: var(--accent-color); }
.chip-dot.yellow { background: var(--warning-color); }
.chip-dot.green { background: var(--success-color); }

/* Right */
.status-right { min-width: 120px; display: flex; justify-content: flex-end; }
.limit-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
