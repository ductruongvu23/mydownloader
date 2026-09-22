<template>
  <header class="navbar">
    <div class="left-actions">
      <el-button type="primary" class="add-btn" @click="$emit('open-add-modal')">
        <el-icon class="el-icon--left"><Plus /></el-icon>
        {{ t('nav.addTask') }}
      </el-button>

      <div class="btn-group">
        <el-tooltip :content="t('nav.resumeAll')" placement="bottom">
          <button class="icon-btn" @click="tasksStore.resumeAll()">
            <el-icon :size="16"><VideoPlay /></el-icon>
          </button>
        </el-tooltip>

        <el-tooltip :content="t('nav.pauseAll')" placement="bottom">
          <button class="icon-btn" @click="tasksStore.pauseAll()">
            <el-icon :size="16"><VideoPause /></el-icon>
          </button>
        </el-tooltip>

        <el-tooltip :content="t('nav.clearDone')" placement="bottom">
          <button class="icon-btn" @click="tasksStore.clearDone()">
            <el-icon :size="16"><Delete /></el-icon>
          </button>
        </el-tooltip>

        <el-tooltip content="Xóa tất cả tác vụ" placement="bottom">
          <button class="icon-btn text-danger" @click="handleClearAll">
            <el-icon :size="16"><DeleteFilled /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>

    <div class="right-search">
      <el-input
        v-model="tasksStore.searchQuery"
        :placeholder="t('nav.search')"
        clearable
        class="search-input"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-tooltip content="Kiểm tra cập nhật" placement="bottom">
        <button class="icon-btn" @click="openUpdate">
          <el-icon :size="16"><Refresh /></el-icon>
        </button>
      </el-tooltip>

      <el-tooltip
        :content="settingsStore.theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'"
        placement="bottom"
      >
        <button class="icon-btn theme-btn" @click="toggleTheme">
          <el-icon :size="16">
            <Sunny v-if="settingsStore.theme === 'dark'" />
            <Moon v-else />
          </el-icon>
        </button>
      </el-tooltip>
    </div>
  </header>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '../stores/tasks'
import { useSettingsStore } from '../stores/settings'

import { ElMessageBox } from 'element-plus'

defineEmits(['open-add-modal'])
const { t } = useI18n()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

function toggleTheme() {
  const next = settingsStore.theme === 'dark' ? 'light' : 'dark'
  settingsStore.update({ theme: next })
}

function openUpdate() {
  tasksStore.currentCategory = 'settings'
}

async function handleClearAll() {
  try {
    await ElMessageBox.confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách tác vụ tải xuống?', 'Xác nhận xóa tất cả', {
      confirmButtonText: 'Xóa tất cả',
      cancelButtonText: 'Hủy',
      type: 'warning'
    })
    await tasksStore.deleteAll(false)
  } catch {}
}
</script>

<style scoped>
.navbar {
  height: 60px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-app);
  flex-shrink: 0;
}

.left-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.add-btn {
  background: var(--accent-gradient) !important;
  border: none !important;
  font-weight: 600;
  padding: 9px 18px;
  box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
}

.btn-group {
  display: flex;
  align-items: center;
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.icon-btn:hover {
  background-color: var(--bg-card-hover);
  color: var(--text-primary);
}

.icon-btn.text-danger:hover {
  color: #f87171;
  background-color: rgba(248, 113, 113, 0.12);
}

.right-search {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input {
  width: 240px;
}

.theme-btn {
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
}
</style>
