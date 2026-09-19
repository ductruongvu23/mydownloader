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

    <div v-else class="task-scroll-area">
      <TaskCard
        v-for="task in tasksStore.filteredTasks"
        :key="task.id"
        :task="task"
      />
    </div>
  </main>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '../stores/tasks'
import TaskCard from './TaskCard.vue'

defineEmits(['open-add-modal'])
const { t } = useI18n()
const tasksStore = useTasksStore()
</script>

<style scoped>
.task-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
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
