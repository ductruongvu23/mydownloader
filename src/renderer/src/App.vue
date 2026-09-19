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
          <Navbar @open-add-modal="showAddModal = true" />
          <TaskList @open-add-modal="showAddModal = true" />
        </template>
      </div>
    </div>

    <!-- STATUS BAR Ở ĐÁY -->
    <StatusBar />

    <!-- MODAL THÊM TÁC VỤ TẢI -->
    <AddTaskModal v-model="showAddModal" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
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

onMounted(async () => {
  await settingsStore.init()
  await tasksStore.init()
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
