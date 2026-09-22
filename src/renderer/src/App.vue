<template>
  <div class="app-layout">
    <div class="app-main-view">
      <!-- SIDEBAR BÊN TRÁI -->
      <Sidebar />

      <!-- KHU VỰC NỘI DUNG CHÍNH -->
      <div class="content-view">
        <!-- Khi xem Cài đặt -->
        <SettingsView v-if="tasksStore.currentCategory === 'settings'" />

        <!-- Khi xem Danh sách tác vụ -->
        <template v-else>
          <Navbar @open-add-modal="openAddModalManual" />
          <TaskList @open-add-modal="openAddModalManual" />
        </template>
      </div>
    </div>

    <!-- STATUS BAR Ở ĐÁY -->
    <StatusBar />

    <!-- MODAL THÊM TÁC VỤ TẢI -->
    <AddTaskModal
      v-model="showAddModal"
      :initial-data="incomingDownload"
      @update:model-value="onModalVisibleChange"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElNotification } from 'element-plus'
import Sidebar from './components/Sidebar.vue'
import Navbar from './components/Navbar.vue'
import TaskList from './components/TaskList.vue'
import SettingsView from './components/SettingsView.vue'
import StatusBar from './components/StatusBar.vue'
import AddTaskModal from './components/AddTaskModal.vue'
import { useTasksStore } from './stores/tasks'
import { useSettingsStore } from './stores/settings'

const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

const showAddModal = ref(false)
const incomingDownload = ref(null)

function openAddModalManual() {
  incomingDownload.value = null
  showAddModal.value = true
}

function onModalVisibleChange(val) {
  if (!val) {
    if (incomingDownload.value?.downloadId) {
      window.api?.setBridgeDecision?.(incomingDownload.value.downloadId, 'cancelled')
    }
    incomingDownload.value = null
  }
}

onMounted(async () => {
  await settingsStore.init()
  await tasksStore.init()

  // Bắt sự kiện khi Extension gửi link sang
  if (window.api?.onLinkReceived) {
    window.api.onLinkReceived((data) => {
      incomingDownload.value = data
      showAddModal.value = true
    })
  }

  // Báo khi phát hiện link trùng lặp từ trình duyệt
  if (window.api?.onDuplicateDetected) {
    window.api.onDuplicateDetected((data) => {
      ElNotification({
        title: 'Liên kết đã có trong danh sách',
        message: `Tệp "${data.filename || data.url}" đã tồn tại (${data.status === 'done' ? 'đã hoàn tất' : 'đang xử lý'}). Đã bỏ qua để tránh ngốn RAM.`,
        type: 'warning',
        duration: 4500
      })
    })
  }
})
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background-color: var(--bg-app);
  overflow: hidden;
}

.app-main-view {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
}

.content-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
</style>
