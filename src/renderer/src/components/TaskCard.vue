<template>
  <div class="task-card" :class="[task.status]" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <!-- File icon -->
    <div class="card-icon" :class="fileType">
      <el-icon :size="22"><component :is="fileTypeIcon" /></el-icon>
      <span class="ext-label">{{ fileExtension }}</span>
    </div>

    <!-- Body -->
    <div class="card-body">
      <!-- Top row: name + status -->
      <div class="name-row">
        <span class="file-name" :title="task.name || task.url">{{ displayName }}</span>
        <span class="status-chip" :class="task.status">{{ statusText }}</span>
      </div>

      <!-- Progress bar -->
      <div class="progress-wrap">
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="[task.status, { animated: task.status === 'active' }]"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
        <span class="progress-pct">{{ progressPercent }}%</span>
      </div>

      <!-- Stats row -->
      <div class="stats-row">
        <div class="stats-left">
          <span class="stat-item size-stat">
            {{ formatBytes(task.downloaded) }}
            <span v-if="task.size > 0" class="size-total"> / {{ formatBytes(task.size) }}</span>
          </span>

          <span v-if="task.status === 'active' && task.speed > 0" class="stat-item speed-stat">
            <el-icon :size="11" class="stat-icon"><Bottom /></el-icon>
            {{ formatSpeed(task.speed) }}
          </span>

          <span v-if="task.status === 'active' && etaText" class="stat-item eta-stat">
            <el-icon :size="11" class="stat-icon"><Timer /></el-icon>
            {{ etaText }}
          </span>

          <span v-if="task.connections > 0" class="stat-item thread-stat">
            <el-icon :size="11" class="stat-icon"><Connection /></el-icon>
            {{ task.connections }}T
          </span>

          <div v-if="task.status === 'error'" class="error-block">
            <el-icon :size="11"><Warning /></el-icon>
            <span class="error-text" :title="task.error">{{ task.error || 'Lỗi tải xuống' }}</span>
            <button class="retry-btn" @click="tasksStore.resume(task.id)">
              <el-icon :size="10"><Refresh /></el-icon> Thử lại
            </button>
          </div>
        </div>

        <!-- Actions (show on hover) -->
        <div class="actions" :class="{ visible: hovered || task.status === 'error' }">
          <el-tooltip v-if="['active','waiting'].includes(task.status)" content="Tạm dừng" placement="top">
            <button class="act-btn" @click="tasksStore.pause(task.id)">
              <el-icon :size="13"><VideoPause /></el-icon>
            </button>
          </el-tooltip>

          <el-tooltip v-if="['paused','error'].includes(task.status)" content="Tiếp tục" placement="top">
            <button class="act-btn accent" @click="tasksStore.resume(task.id)">
              <el-icon :size="13"><VideoPlay /></el-icon>
            </button>
          </el-tooltip>

          <el-tooltip v-if="task.status === 'done' && task.dest" content="Mở file" placement="top">
            <button class="act-btn success" @click="tasksStore.openFile(task.dest)">
              <el-icon :size="13"><Document /></el-icon>
            </button>
          </el-tooltip>

          <el-tooltip v-if="task.dest" content="Mở thư mục" placement="top">
            <button class="act-btn" @click="tasksStore.showInFolder(task.dest)">
              <el-icon :size="13"><FolderOpened /></el-icon>
            </button>
          </el-tooltip>

          <el-dropdown trigger="click" @command="handleCommand">
            <button class="act-btn">
              <el-icon :size="13"><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="copyLink">
                  <el-icon><CopyDocument /></el-icon> Sao chép link
                </el-dropdown-item>
                <el-dropdown-item command="delete" divided style="color: var(--danger-color)">
                  <el-icon><Delete /></el-icon> Xóa tác vụ
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>

    <!-- Delete dialog -->
    <el-dialog v-model="showDeleteDialog" title="Xóa tác vụ" width="400px" append-to-body>
      <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6">
        Bạn có chắc muốn xóa tác vụ này?
      </p>
      <div style="margin-top: 14px">
        <el-checkbox v-model="deleteWithFile">Xóa cả file đã tải</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="showDeleteDialog = false">Hủy</el-button>
        <el-button type="danger" @click="confirmDelete">Xóa</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useTasksStore } from '../stores/tasks'

const props = defineProps({ task: { type: Object, required: true } })
const tasksStore = useTasksStore()
const hovered = ref(false)
const showDeleteDialog = ref(false)
const deleteWithFile = ref(false)

const displayName = computed(() => {
  if (props.task.name && props.task.name !== 'Đang kết nối...') return props.task.name
  try {
    const parsed = new URL(props.task.url)
    const base = parsed.pathname.split('/').filter(Boolean).pop()
    const decoded = decodeURIComponent(base || '')
    if (decoded && decoded.length > 60) return decoded.slice(0, 40) + '...' + (decoded.includes('.') ? '.' + decoded.split('.').pop() : '')
    return decoded || parsed.hostname
  } catch {
    const u = props.task.url || ''
    return u.length > 60 ? u.slice(0, 55) + '...' : u
  }
})

const progressPercent = computed(() => {
  if (!props.task.size || props.task.size <= 0) return props.task.status === 'done' ? 100 : 0
  return Math.min(100, Math.max(0, Number(((props.task.downloaded / props.task.size) * 100).toFixed(1))))
})

const statusText = computed(() => {
  const map = { active: 'Đang tải', waiting: 'Chờ', paused: 'Dừng', done: 'Hoàn tất', error: 'Lỗi' }
  return map[props.task.status] || props.task.status
})

const etaText = computed(() => {
  if (props.task.status !== 'active' || !props.task.speed || props.task.speed <= 0) return ''
  const rem = props.task.size - props.task.downloaded
  if (rem <= 0) return ''
  const s = Math.round(rem / props.task.speed)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
})

const fileType = computed(() => {
  const n = (props.task.name || props.task.url || '').toLowerCase()
  if (/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i.test(n)) return 'video'
  if (/\.(mp3|flac|wav|ogg|aac|m4a)$/i.test(n)) return 'audio'
  if (/\.(zip|rar|7z|tar|gz|bz2|iso)$/i.test(n)) return 'archive'
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|epub)$/i.test(n)) return 'document'
  if (/\.(exe|msi|dmg|pkg|deb|rpm|appimage)$/i.test(n)) return 'executable'
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(n)) return 'image'
  return 'default'
})

const fileExtension = computed(() => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(props.task.name || '')
  if (m) return m[1].toUpperCase()
  return fileType.value === 'default' ? 'FILE' : fileType.value.slice(0, 4).toUpperCase()
})

const fileTypeIcon = computed(() => {
  const map = { video: 'VideoPlay', audio: 'Headset', archive: 'Box', document: 'Document', executable: 'Monitor', image: 'Picture' }
  return map[fileType.value] || 'Files'
})

function formatBytes(b) {
  if (!b || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${u[i]}`
}

function formatSpeed(bps) {
  if (!bps || bps <= 0) return '0 KB/s'
  if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`
  return `${(bps / 1024).toFixed(1)} KB/s`
}

function handleCommand(cmd) {
  if (cmd === 'copyLink') {
    navigator.clipboard.writeText(props.task.url)
    ElMessage.success('Đã sao chép link')
  } else if (cmd === 'delete') {
    showDeleteDialog.value = true
  }
}

async function confirmDelete() {
  await tasksStore.remove(props.task.id, deleteWithFile.value)
  showDeleteDialog.value = false
  deleteWithFile.value = false
}
</script>

<style scoped>
.task-card {
  display: flex;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  padding: 14px 16px;
  margin-bottom: 8px;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-sm);
  animation: slide-in 0.2s ease both;
  position: relative;
  overflow: hidden;
}

/* Glow border khi active */
.task-card.active {
  border-color: rgba(56, 189, 248, 0.3);
  box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.1), var(--shadow-md);
}
.task-card.active::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--accent-gradient);
}

.task-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.task-card.done {
  border-color: rgba(52, 211, 153, 0.2);
}
.task-card.error {
  border-color: rgba(248, 113, 113, 0.3);
}

/* Icon */
.card-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.04);
  color: var(--text-muted);
  border: 1px solid rgba(255,255,255,0.06);
  transition: all var(--transition-fast);
}

.card-icon.video { background: rgba(239,68,68,0.12); color: #f87171; border-color: rgba(239,68,68,0.2); }
.card-icon.audio { background: rgba(234,179,8,0.12); color: #facc15; border-color: rgba(234,179,8,0.2); }
.card-icon.archive { background: rgba(168,85,247,0.12); color: #c084fc; border-color: rgba(168,85,247,0.2); }
.card-icon.document { background: rgba(59,130,246,0.12); color: #60a5fa; border-color: rgba(59,130,246,0.2); }
.card-icon.executable { background: rgba(16,185,129,0.12); color: #34d399; border-color: rgba(16,185,129,0.2); }
.card-icon.image { background: rgba(236,72,153,0.12); color: #f472b6; border-color: rgba(236,72,153,0.2); }

.ext-label {
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.5px;
  margin-top: 1px;
  opacity: 0.8;
}

/* Body */
.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Name row */
.name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.file-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.2px;
}
.status-chip {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 20px;
  flex-shrink: 0;
  letter-spacing: 0.2px;
}
.status-chip.active { background: rgba(56,189,248,0.12); color: var(--accent-color); border: 1px solid rgba(56,189,248,0.25); }
.status-chip.waiting { background: rgba(251,191,36,0.12); color: var(--warning-color); border: 1px solid rgba(251,191,36,0.25); }
.status-chip.paused { background: rgba(100,116,139,0.12); color: var(--text-muted); border: 1px solid var(--border-color); }
.status-chip.done { background: rgba(52,211,153,0.12); color: var(--success-color); border: 1px solid rgba(52,211,153,0.25); }
.status-chip.error { background: rgba(248,113,113,0.12); color: var(--danger-color); border: 1px solid rgba(248,113,113,0.25); }

/* Progress */
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-track {
  flex: 1;
  height: 6px;
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}
.progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}
.progress-fill.active {
  background: var(--accent-gradient);
  position: relative;
}
.progress-fill.active.animated::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
.progress-fill.done { background: var(--success-color); }
.progress-fill.paused { background: var(--text-muted); opacity: 0.5; }
.progress-fill.waiting {
  background: var(--warning-color);
  background-size: 20px 100%;
  animation: waiting-stripes 1s linear infinite;
}
@keyframes waiting-stripes {
  from { background-position: 0 0; }
  to { background-position: 20px 0; }
}
.progress-fill.error { background: var(--danger-color); opacity: 0.6; }

.progress-pct {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Stats row */
.stats-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.stats-left {
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
  flex: 1;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  white-space: nowrap;
}
.stat-icon { opacity: 0.7; }
.size-stat { color: var(--text-primary); font-weight: 500; }
.size-total { color: var(--text-muted); font-weight: 400; }
.speed-stat { color: var(--accent-color); font-weight: 700; }
.eta-stat { color: var(--text-secondary); }
.thread-stat { color: var(--info-color); }

/* Error block */
.error-block {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--danger-color);
  font-size: 11.5px;
}
.error-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(248,113,113,0.12);
  color: var(--danger-color);
  border: 1px solid rgba(248,113,113,0.3);
  border-radius: 5px;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.retry-btn:hover { background: var(--danger-color); color: #fff; }

/* Actions */
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.actions.visible { opacity: 1; }

.act-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.act-btn:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--border-color);
  color: var(--text-primary);
}
.act-btn.accent { color: var(--accent-color); background: rgba(56,189,248,0.08); }
.act-btn.accent:hover { background: var(--accent-color); color: #fff; }
.act-btn.success { color: var(--success-color); background: rgba(52,211,153,0.08); }
.act-btn.success:hover { background: var(--success-color); color: #fff; }
</style>
