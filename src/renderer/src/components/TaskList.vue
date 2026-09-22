<template>
  <main class="task-list-container">
    <div v-if="tasksStore.filteredTasks.length === 0" class="empty-state">
      <div class="empty-icon">
        <el-icon :size="48"><FolderRemove /></el-icon>
      </div>
      <h3 class="empty-title">{{ t('task.empty') }}</h3>
      <p class="empty-desc">{{ t('task.emptyDesc') }}</p>
      <el-button type="primary" class="empty-btn" @click="$emit('open-add-modal')">
        <el-icon class="el-icon--left"><Plus /></el-icon>
        {{ t('nav.addTask') }}
      </el-button>
    </div>

    <div v-else class="task-content">
      <!-- Toolbar chọn & xóa hàng loạt / xóa tất cả -->
      <div class="batch-toolbar">
        <div class="toolbar-left">
          <el-checkbox
            :model-value="tasksStore.isAllSelected"
            :indeterminate="tasksStore.isIndeterminate"
            @change="tasksStore.selectAll"
          >
            <span class="select-label">Chọn tất cả ({{ tasksStore.filteredTasks.length }})</span>
          </el-checkbox>

          <span v-if="tasksStore.selectedCount > 0" class="selected-badge">
            Đã chọn {{ tasksStore.selectedCount }}
          </span>
        </div>

        <div class="toolbar-right">
          <template v-if="tasksStore.selectedCount > 0">
            <el-button size="small" @click="tasksStore.pauseSelected()">
              <el-icon class="el-icon--left"><VideoPause /></el-icon>
              Tạm dừng
            </el-button>
            <el-button size="small" @click="tasksStore.resumeSelected()">
              <el-icon class="el-icon--left"><VideoPlay /></el-icon>
              Tiếp tục
            </el-button>
            <el-button size="small" type="danger" plain @click="showBatchDeleteDialog = true">
              <el-icon class="el-icon--left"><Delete /></el-icon>
              Xóa đã chọn
            </el-button>
          </template>

          <el-button size="small" type="danger" @click="showClearAllDialog = true">
            <el-icon class="el-icon--left"><DeleteFilled /></el-icon>
            Xóa tất cả
          </el-button>
        </div>
      </div>

      <div class="task-scroll-area">
        <TaskCard
          v-for="task in tasksStore.filteredTasks"
          :key="task.id"
          :task="task"
        />
      </div>
    </div>

    <!-- Dialog xác nhận xóa tất cả -->
    <el-dialog
      v-model="showClearAllDialog"
      title="Xóa tất cả tác vụ tải xuống"
      width="440px"
      append-to-body
    >
      <p>Bạn có chắc chắn muốn xóa toàn bộ <b>{{ tasksStore.tasks.length }}</b> tác vụ trong danh sách?</p>
      <div style="margin-top: 14px;">
        <el-checkbox v-model="clearAllFiles">Đồng thời xóa các tệp đã tải xuống trên ổ đĩa</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="showClearAllDialog = false">Hủy</el-button>
        <el-button type="danger" :loading="clearing" @click="confirmDeleteAll">Xác nhận xóa</el-button>
      </template>
    </el-dialog>

    <!-- Dialog xác nhận xóa mục đã chọn -->
    <el-dialog
      v-model="showBatchDeleteDialog"
      title="Xóa các tác vụ đã chọn"
      width="440px"
      append-to-body
    >
      <p>Bạn có chắc muốn xóa <b>{{ tasksStore.selectedCount }}</b> tác vụ đã chọn?</p>
      <div style="margin-top: 14px;">
        <el-checkbox v-model="batchDeleteFiles">Đồng thời xóa các tệp đã tải xuống trên ổ đĩa</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="showBatchDeleteDialog = false">Hủy</el-button>
        <el-button type="danger" :loading="clearing" @click="confirmDeleteSelected">Xác nhận xóa</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '../stores/tasks'
import TaskCard from './TaskCard.vue'

defineEmits(['open-add-modal'])
const { t } = useI18n()
const tasksStore = useTasksStore()

const showClearAllDialog = ref(false)
const clearAllFiles = ref(false)
const showBatchDeleteDialog = ref(false)
const batchDeleteFiles = ref(false)
const clearing = ref(false)

async function confirmDeleteAll() {
  clearing.value = true
  try {
    await tasksStore.deleteAll(clearAllFiles.value)
    showClearAllDialog.value = false
    clearAllFiles.value = false
  } finally {
    clearing.value = false
  }
}

async function confirmDeleteSelected() {
  clearing.value = true
  try {
    await tasksStore.deleteSelected(batchDeleteFiles.value)
    showBatchDeleteDialog.value = false
    batchDeleteFiles.value = false
  } finally {
    clearing.value = false
  }
}
</script>

<style scoped>
.task-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
}

.task-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-sm);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.select-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.selected-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-color);
  background: rgba(14, 165, 233, 0.12);
  padding: 2px 8px;
  border-radius: 12px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.empty-state {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 20px;
  max-width: 360px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.empty-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 20px;
}

.empty-btn {
  background: var(--accent-gradient) !important;
  border: none !important;
  font-weight: 600;
}

.task-scroll-area {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
