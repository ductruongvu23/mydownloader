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

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">Thư mục Tiện ích (Extension)</span>
            <div class="update-subtext">Đã cài đặt sẵn cùng ứng dụng (phiên bản v{{ currentAppVersion }})</div>
          </div>
          <div class="form-control">
            <el-button type="primary" plain @click="openExtFolder">
              <el-icon class="el-icon--left"><FolderOpened /></el-icon>
              Mở thư mục Extension trên máy
            </el-button>
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

      <!-- MỤC 4: CẬP NHẬT PHẦN MỀM -->
      <section class="settings-section">
        <h3 class="section-title">Cập nhật phần mềm</h3>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">Phiên bản hiện tại</span>
          </div>
          <div class="form-control">
            <el-tag type="info" size="large" effect="plain" round>v{{ currentAppVersion }}</el-tag>
          </div>
        </div>

        <div class="form-row">
          <div class="form-label">
            <span class="label-text">Kiểm tra phiên bản mới trên GitHub</span>
            <div v-if="lastCheckStatus" class="update-subtext">
              {{ lastCheckStatus }}
            </div>
          </div>
          <div class="form-control">
            <el-button
              type="primary"
              :loading="checkingUpdate"
              @click="checkUpdates"
            >
              <el-icon class="el-icon--left"><Refresh /></el-icon>
              Kiểm tra cập nhật
            </el-button>
          </div>
        </div>

        <!-- Khung hiển thị khi có bản cập nhật mới -->
        <div v-if="updateInfo && updateInfo.updateAvailable" class="update-card">
          <div class="update-header-info">
            <div class="update-badge">
              <el-icon color="#38bdf8" :size="18"><Check /></el-icon>
              <span class="update-name">Có phiên bản mới: <b>v{{ updateInfo.latestVersion }}</b></span>
              <el-tag v-if="updateInfo.isFastUpdate" type="success" size="small" effect="dark" round>
                ⚡ Cập nhật siêu tốc (~{{ formatBytes(updateInfo.assetSize) }})
              </el-tag>
            </div>
            <span v-if="updateInfo.assetSize" class="update-size">
              {{ formatBytes(updateInfo.assetSize) }}
              <span v-if="updateInfo.isFastUpdate" class="size-saving">(giảm 99% so với 88 MB)</span>
            </span>
          </div>

          <div v-if="updateInfo.isFastUpdate" class="fast-update-banner">
            <el-icon color="#67c23a"><Check /></el-icon>
            <span>Cập nhật trực tiếp mã nguồn trong <b>2 giây</b>, không cần tải lại toàn bộ runtime hay mở lại bộ cài Windows.</span>
          </div>

          <div v-if="updateInfo.releaseNotes" class="update-notes-box">
            <div class="notes-heading">Nội dung cập nhật:</div>
            <pre class="notes-text">{{ updateInfo.releaseNotes }}</pre>
          </div>

          <!-- Tiến trình tải -->
          <div v-if="downloadingUpdate" class="update-progress-wrap">
            <el-progress :percentage="downloadProgress" :status="downloadProgress === 100 ? 'success' : ''" />
            <div class="progress-details">
              <span>Đang tải gói cập nhật... {{ downloadProgress }}%</span>
              <span v-if="downloadReceived && downloadTotal">
                {{ formatBytes(downloadReceived) }} / {{ formatBytes(downloadTotal) }}
              </span>
            </div>
          </div>

          <div class="update-action-row">
            <el-link
              v-if="updateInfo.setupDownloadUrl"
              type="info"
              :underline="false"
              class="full-installer-link"
              @click="openSetupUrl"
            >
              Tải bộ cài đặt đầy đủ (.exe)
            </el-link>

            <el-button
              v-if="!downloadedInstallerPath"
              type="success"
              :loading="downloadingUpdate"
              @click="startDownloadUpdate"
            >
              <el-icon class="el-icon--left"><Download /></el-icon>
              {{ downloadingUpdate ? 'Đang tải bản cập nhật...' : (updateInfo.isFastUpdate ? `Tải bản cập nhật siêu tốc (${formatBytes(updateInfo.assetSize)})` : 'Tự động tải về & Cập nhật') }}
            </el-button>

            <el-button
              v-else
              type="primary"
              @click="installAndRelaunch"
            >
              <el-icon class="el-icon--left"><VideoPlay /></el-icon>
              {{ updateInfo.isFastUpdate ? 'Cập nhật & Khởi động lại ngay (2s)' : 'Cài đặt & Khởi động lại' }}
            </el-button>
          </div>
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
const currentAppVersion = ref('1.0.6')
const checkingUpdate = ref(false)
const lastCheckStatus = ref('')
const updateInfo = ref(null)
const downloadingUpdate = ref(false)
const downloadProgress = ref(0)
const downloadReceived = ref(0)
const downloadTotal = ref(0)
const downloadedInstallerPath = ref('')

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

onMounted(async () => {
  if (window.api?.getAppVersion) {
    try {
      const v = await window.api.getAppVersion()
      if (v) currentAppVersion.value = v
    } catch {}
  }

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

function formatBytes(b) {
  if (!b || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${u[i]}`
}

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

async function checkUpdates() {
  if (!window.api?.checkUpdate) {
    ElMessage.info('Chức năng cập nhật hoạt động trong ứng dụng đã cài đặt.')
    return
  }
  checkingUpdate.value = true
  lastCheckStatus.value = 'Đang kết nối GitHub kiểm tra bản phát hành mới...'
  try {
    const res = await window.api.checkUpdate()
    updateInfo.value = res
    if (res.currentVersion) {
      currentAppVersion.value = res.currentVersion
    }
    if (res.error) {
      lastCheckStatus.value = `Lỗi: ${res.error}`
      ElMessage.error(`Kiểm tra cập nhật thất bại: ${res.error}`)
    } else if (res.updateAvailable) {
      lastCheckStatus.value = `Đã tìm thấy phiên bản mới v${res.latestVersion}!`
      ElMessage.success(`Có phiên bản cập nhật mới: v${res.latestVersion}!`)
    } else {
      lastCheckStatus.value = res.message || `Bạn đang sử dụng phiên bản mới nhất (v${res.currentVersion}).`
      ElMessage.success(lastCheckStatus.value)
    }
  } catch (err) {
    lastCheckStatus.value = `Lỗi: ${err.message}`
    ElMessage.error(lastCheckStatus.value)
  } finally {
    checkingUpdate.value = false
  }
}

async function startDownloadUpdate() {
  if (!updateInfo.value?.downloadUrl) {
    ElMessage.warning('Không tìm thấy liên kết tệp cài đặt trên GitHub!')
    return
  }
  downloadingUpdate.value = true
  downloadProgress.value = 0

  let removeListener = null
  if (window.api?.onUpdateProgress) {
    removeListener = window.api.onUpdateProgress((p) => {
      downloadProgress.value = p.percent || 0
      downloadReceived.value = p.receivedBytes || 0
      downloadTotal.value = p.totalBytes || 0
    })
  }

  try {
    const res = await window.api.downloadUpdate({
      downloadUrl: updateInfo.value.downloadUrl,
      assetName: updateInfo.value.assetName
    })
    if (res.success) {
      downloadedInstallerPath.value = res.destPath
      ElMessage.success('Đã tải xong bản cập nhật! Nhấn Cài đặt & Khởi động lại.')
    } else {
      ElMessage.error(`Tải bản cập nhật thất bại: ${res.error}`)
    }
  } catch (err) {
    ElMessage.error(`Lỗi tải: ${err.message}`)
  } finally {
    downloadingUpdate.value = false
    if (removeListener) removeListener()
  }
}

async function installAndRelaunch() {
  if (!downloadedInstallerPath.value) return
  try {
    await window.api.installUpdate(downloadedInstallerPath.value)
  } catch (err) {
    ElMessage.error(`Lỗi khởi chạy cài đặt: ${err.message}`)
  }
}

function openSetupUrl() {
  if (updateInfo.value?.setupDownloadUrl) {
    window.api.openFile(updateInfo.value.setupDownloadUrl)
  }
}

async function openExtFolder() {
  if (window.api?.openExtensionFolder) {
    const res = await window.api.openExtensionFolder()
    if (res.success) {
      ElMessage.success('Đã mở thư mục Extension trong File Explorer!')
    } else {
      ElMessage.error(res.error || 'Không mở được thư mục extension.')
    }
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

.update-subtext {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
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

.update-card {
  background: rgba(14, 165, 233, 0.05);
  border: 1px solid rgba(14, 165, 233, 0.25);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.update-header-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.update-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-name {
  font-size: 14px;
  color: var(--text-primary);
}

.update-size {
  font-size: 12px;
  color: var(--text-muted);
}

.update-notes-box {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  padding: 10px 12px;
}

.notes-heading {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.notes-text {
  font-size: 12px;
  font-family: inherit;
  color: var(--text-primary);
  white-space: pre-wrap;
  margin: 0;
}

.update-progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-details {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.update-action-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.size-saving {
  color: #67c23a;
  font-weight: 500;
  margin-left: 4px;
}

.fast-update-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(103, 194, 58, 0.1);
  border: 1px solid rgba(103, 194, 58, 0.25);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--text-primary);
  line-height: 1.4;
}

.full-installer-link {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s;
}

.full-installer-link:hover {
  color: var(--text-primary);
  text-decoration: underline;
}
</style>
