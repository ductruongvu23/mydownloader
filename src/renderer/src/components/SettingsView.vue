<template>
  <div class="settings-container">
    <div class="settings-header">
      <h2 class="settings-title">{{ t('settings.title') }}</h2>
      <el-button type="primary" class="save-btn" @click="save">
        <el-icon class="el-icon--left"><Check /></el-icon>
        {{ t('settings.save') }}
      </el-button>
    </div>

    <div class="settings-content">
      <!-- MỤC 1: CƠ BẢN -->
      <section class="settings-section">
        <h3 class="section-title">{{ t('settings.basic') }}</h3>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.downloadDir') }}</span>
          </div>
          <div class="form-control dir-row">
            <el-input v-model="form.downloadDir" readonly />
            <el-button @click="chooseDir">{{ t('add.browse') }}</el-button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.language') }}</span>
          </div>
          <div class="form-control">
            <el-select v-model="form.language" class="select-field">
              <el-option label="Tiếng Việt" value="vi" />
              <el-option label="English" value="en" />
            </el-select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.theme') }}</span>
          </div>
          <div class="form-control">
            <el-radio-group v-model="form.theme">
              <el-radio-button label="dark">{{ t('settings.themeDark') }}</el-radio-button>
              <el-radio-button label="light">{{ t('settings.themeLight') }}</el-radio-button>
              <el-radio-button label="system">{{ t('settings.themeSystem') }}</el-radio-button>
            </el-radio-group>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.notifyOnComplete') }}</span>
          </div>
          <div class="form-control">
            <el-switch v-model="form.notifyOnComplete" />
          </div>
        </div>
      </section>

      <!-- MỤC 2: NÂNG CAO -->
      <section class="settings-section">
        <h3 class="section-title">{{ t('settings.advanced') }}</h3>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.maxConcurrent') }}</span>
          </div>
          <div class="form-control">
            <el-input-number v-model="form.maxConcurrent" :min="1" :max="10" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.defaultThreads') }}</span>
          </div>
          <div class="form-control">
            <el-input-number v-model="form.threads" :min="1" :max="32" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.speedLimit') }}</span>
          </div>
          <div class="form-control">
            <el-input-number v-model="speedLimitKB" :min="0" :step="100" />
            <span class="unit-note">KB/s (0 = Không giới hạn)</span>
          </div>
        </div>
      </section>

      <!-- MỤC 3: TÍCH HỢP TRÌNH DUYỆT -->
      <section class="settings-section">
        <h3 class="section-title">{{ t('settings.extension') }}</h3>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.bridgeStatus') }}</span>
          </div>
          <div class="form-control">
            <el-switch v-model="form.bridgeEnabled" />
            <span class="unit-note" style="margin-left: 10px;">
              {{ form.bridgeEnabled ? 'Đang mở tại cổng 127.0.0.1:' + form.bridgePort : 'Đã tắt' }}
            </span>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.bridgePort') }}</span>
          </div>
          <div class="form-control">
            <el-input-number v-model="form.bridgePort" :min="1024" :max="65535" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">{{ t('settings.token') }}</span>
          </div>
          <div class="form-control dir-row">
            <el-input v-model="form.extensionToken" readonly />
            <el-button @click="copyToken">{{ t('settings.copyToken') }}</el-button>
            <el-button @click="regenerateToken">Tạo mới</el-button>
          </div>
        </div>

        <!-- HƯỚNG DẪN CÀI EXTENSION -->
        <div class="guide-box">
          <h4 class="guide-heading">{{ t('settings.guideTitle') }}</h4>
          <ol class="guide-list">
            <li>{{ t('settings.guide1') }}</li>
            <li>{{ t('settings.guide2') }}</li>
            <li>{{ t('settings.guide3') }}</li>
            <li>{{ t('settings.guide4') }}</li>
          </ol>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '../stores/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const speedLimitKB = ref(0)
const form = reactive({
  downloadDir: '',
  language: 'vi',
  theme: 'dark',
  maxConcurrent: 5,
  threads: 8,
  notifyOnComplete: true,
  bridgeEnabled: true,
  bridgePort: 6801,
  extensionToken: ''
})

onMounted(() => {
  Object.assign(form, {
    downloadDir: settingsStore.downloadDir,
    language: settingsStore.language,
    theme: settingsStore.theme,
    maxConcurrent: settingsStore.maxConcurrent,
    threads: settingsStore.threads,
    notifyOnComplete: settingsStore.notifyOnComplete,
    bridgeEnabled: settingsStore.bridgeEnabled,
    bridgePort: settingsStore.bridgePort,
    extensionToken: settingsStore.extensionToken
  })
  speedLimitKB.value = Math.round((settingsStore.speedLimit || 0) / 1024)
})

async function chooseDir() {
  const dir = await settingsStore.chooseDirectory()
  if (dir) form.downloadDir = dir
}

function copyToken() {
  navigator.clipboard.writeText(form.extensionToken)
  ElMessage.success(t('settings.tokenCopied'))
}

function regenerateToken() {
  const chars = '0123456789abcdef'
  let res = ''
  for (let i = 0; i < 32; i++) {
    res += chars[Math.floor(Math.random() * chars.length)]
  }
  form.extensionToken = res
}

async function save() {
  const speedLimitBytes = (speedLimitKB.value || 0) * 1024
  const ok = await settingsStore.update({
    ...form,
    speedLimit: speedLimitBytes
  })
  if (ok) {
    ElMessage.success(t('settings.saved'))
  }
}
</script>

<style scoped>
.settings-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 24px 32px;
  background-color: var(--bg-app);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.settings-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.save-btn {
  background: var(--accent-gradient) !important;
  border: none !important;
  font-weight: 600;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 780px;
}

.settings-section {
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent-color);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.form-label {
  flex: 1;
}

.label-text {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
}

.form-control {
  display: flex;
  align-items: center;
}

.dir-row {
  width: 380px;
  gap: 8px;
}

.select-field {
  width: 180px;
}

.unit-note {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 10px;
}

.guide-box {
  background-color: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  padding: 14px 16px;
  margin-top: 6px;
}

.guide-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.guide-list {
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
