<template>
  <el-dialog
    v-model="visible"
    :title="t('add.title')"
    width="600px"
    class="add-task-dialog"
    destroy-on-close
    append-to-body
  >
    <el-tabs v-model="activeTab" class="add-tabs">
      <!-- TAB 1: HTTP / HTTPS LINK -->
      <el-tab-pane :label="t('add.tabUrl')" name="url">
        <el-form label-position="top">
          <el-form-item :label="t('add.tabUrl')">
            <el-input
              v-model="urlText"
              type="textarea"
              :rows="4"
              :placeholder="t('add.urlPlaceholder')"
              class="url-textarea"
            />
          </el-form-item>

          <el-form-item :label="t('add.saveDir')">
            <div class="dir-picker-row">
              <el-input
                v-model="targetDir"
                placeholder="Đường dẫn thư mục lưu tệp..."
                clearable
              >
                <template #prefix>
                  <el-icon><Folder /></el-icon>
                </template>
              </el-input>
              <el-button type="primary" plain @click="chooseDir">
                <el-icon class="el-icon--left"><FolderOpened /></el-icon>
                {{ t('add.browse') }}
              </el-button>
            </div>
          </el-form-item>

          <el-form-item :label="t('add.customName')">
            <el-input
              v-model="customFilename"
              :placeholder="isMultiUrl ? 'Chỉ áp dụng khi tải 1 liên kết' : 'Tùy chọn (để trống sẽ tự lấy từ máy chủ)'"
              :disabled="isMultiUrl"
            />
          </el-form-item>

          <el-form-item :label="`${t('add.threads')}: ${threads}`">
            <div class="slider-row">
              <el-slider v-model="threads" :min="1" :max="32" :step="1" class="threads-slider" />
              <div class="preset-btns">
                <el-tag
                  v-for="p in [4, 8, 16, 32]"
                  :key="p"
                  class="preset-tag"
                  :class="{ active: threads === p }"
                  @click="threads = p"
                >
                  {{ p }}
                </el-tag>
              </div>
            </div>
          </el-form-item>

          <!-- TÙY CHỌN NÂNG CAO -->
          <el-collapse class="adv-collapse">
            <el-collapse-item :title="t('add.advanced')" name="adv">
              <el-form-item :label="t('add.cookie')">
                <el-input v-model="cookie" placeholder="name=value; ..." />
              </el-form-item>
              <el-form-item :label="t('add.referer')">
                <el-input v-model="referer" placeholder="https://site.com/..." />
              </el-form-item>
              <el-form-item :label="t('add.userAgent')">
                <el-input v-model="userAgent" placeholder="Mozilla/5.0 ..." />
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
        </el-form>
      </el-tab-pane>

      <!-- TAB 2: TORRENT / MAGNET -->
      <el-tab-pane :label="t('add.tabTorrent')" name="torrent">
        <el-form label-position="top">
          <el-form-item label="Magnet Link:">
            <el-input
              v-model="magnetUri"
              type="textarea"
              :rows="3"
              :placeholder="t('add.torrentPlaceholder')"
            />
          </el-form-item>

          <el-form-item :label="t('add.saveDir')">
            <div class="dir-picker-row">
              <el-input
                v-model="targetDir"
                placeholder="Đường dẫn thư mục lưu tệp..."
                clearable
              >
                <template #prefix>
                  <el-icon><Folder /></el-icon>
                </template>
              </el-input>
              <el-button type="primary" plain @click="chooseDir">
                <el-icon class="el-icon--left"><FolderOpened /></el-icon>
                {{ t('add.browse') }}
              </el-button>
            </div>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleCancel">{{ t('add.cancel') }}</el-button>
        <el-button
          type="primary"
          :disabled="!canSubmit"
          :loading="submitting"
          class="submit-btn"
          @click="submit"
        >
          {{ t('add.start') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useTasksStore } from '../stores/tasks'
import { useSettingsStore } from '../stores/settings'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  initialData: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const activeTab = ref('url')
const urlText = ref('')
const targetDir = ref('')
const customFilename = ref('')
const threads = ref(8)
const cookie = ref('')
const referer = ref('')
const userAgent = ref('')
const magnetUri = ref('')
const submitting = ref(false)

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      targetDir.value = settingsStore.downloadDir || ''
      threads.value = settingsStore.threads || 8
      if (props.initialData) {
        if (props.initialData.url) urlText.value = props.initialData.url
        if (props.initialData.filename) customFilename.value = props.initialData.filename
        if (props.initialData.cookies) cookie.value = props.initialData.cookies
        if (props.initialData.threads) threads.value = props.initialData.threads
        if (props.initialData.headers?.Referer) referer.value = props.initialData.headers.Referer
        if (props.initialData.headers?.['User-Agent']) userAgent.value = props.initialData.headers['User-Agent']
      }
    } else {
      urlText.value = ''
      customFilename.value = ''
      cookie.value = ''
      referer.value = ''
      userAgent.value = ''
    }
  }
)

const isMultiUrl = computed(() => {
  const lines = urlText.value.split('\n').filter((l) => l.trim().length > 0)
  return lines.length > 1 || /\[\d+-\d+\]/.test(urlText.value)
})

const canSubmit = computed(() => {
  if (activeTab.value === 'url') {
    return urlText.value.trim().length > 0
  }
  return magnetUri.value.trim().length > 0
})

function cleanUrl(u) {
  if (!u || typeof u !== 'string') return ''
  // Chỉ xóa dấu nháy bao quanh URL, giữ nguyên các ký tự hợp lệ trong URL
  return u
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}

async function chooseDir() {
  try {
    if (!window.api) {
      console.error('[chooseDir] window.api không tồn tại!')
      return
    }
    const dir = await window.api.selectDirectory()
    console.log('[chooseDir] Đã chọn thư mục:', dir)
    if (dir) {
      targetDir.value = dir
      settingsStore.downloadDir = dir
    }
  } catch (err) {
    console.error('[chooseDir] Lỗi chọn thư mục:', err)
  }
}

async function submit() {
  const dir = targetDir.value.trim() || settingsStore.downloadDir
  submitting.value = true

  console.log('[submit] activeTab:', activeTab.value)
  console.log('[submit] dir:', dir)
  console.log('[submit] urlText raw:', JSON.stringify(urlText.value).slice(0, 300))
  console.log('[submit] window.api exists:', !!window.api)

  try {
    if (activeTab.value === 'url') {
      const rawLines = urlText.value.split('\n').map((l) => l.trim()).filter(Boolean)
      console.log('[submit] rawLines:', rawLines.length, rawLines[0]?.slice(0, 100))

      const urls = rawLines
        .map(cleanUrl)
        .filter((u) => Boolean(u) && /^https?:\/\//i.test(u))

      console.log('[submit] filtered URLs:', urls.length, urls[0]?.slice(0, 100))

      if (urls.length === 0) {
        console.warn('[submit] Không URL nào hợp lệ! rawLines:', JSON.stringify(rawLines).slice(0, 300))
        ElMessage.warning('Vui lòng nhập liên kết tải xuống hợp lệ (bắt đầu bằng http:// hoặc https://)!')
        return
      }

      const headers = {}
      if (cookie.value.trim()) headers.Cookie = cookie.value.trim()
      if (referer.value.trim()) headers.Referer = referer.value.trim()
      if (userAgent.value.trim()) headers['User-Agent'] = userAgent.value.trim()

      const opts = {
        dir,
        filename: !isMultiUrl.value ? customFilename.value.trim() : '',
        threads: threads.value,
        headers
      }
      console.log('[submit] gọi addTasks với', urls.length, 'URL, opts:', JSON.stringify(opts).slice(0, 200))

      const added = await tasksStore.addTasks(urls, opts)

      console.log('[submit] addTasks trả về:', JSON.stringify(added).slice(0, 300))

      if (dir && dir !== settingsStore.downloadDir) {
        settingsStore.update({ downloadDir: dir })
      }

      if (added && added.length > 0) {
        if (props.initialData?.downloadId) {
          window.api?.setBridgeDecision?.(props.initialData.downloadId, 'started')
        }
        ElMessage.success(`Đã thêm ${added.length} nhiệm vụ tải xuống thành công!`)
        visible.value = false
        urlText.value = ''
        customFilename.value = ''
        cookie.value = ''
        referer.value = ''
        userAgent.value = ''
      } else {
        console.warn('[submit] addTasks trả về rỗng:', added)
        ElMessage.error('Không tìm thấy liên kết hợp lệ để thêm!')
      }
    } else {
      // Torrent / Magnet
      const uri = magnetUri.value.trim()
      if (!uri) return
      await tasksStore.addTasks([uri], { dir })
      if (props.initialData?.downloadId) {
        window.api?.setBridgeDecision?.(props.initialData.downloadId, 'started')
      }
      ElMessage.success('Đã thêm Magnet link vào hàng đợi!')
      visible.value = false
      magnetUri.value = ''
    }
  } catch (err) {
    console.error('[submit] LỖI:', err)
    ElMessage.error(`Thêm tác vụ thất bại: ${err.message}`)
  } finally {
    submitting.value = false
  }
}

function handleCancel() {
  if (props.initialData?.downloadId) {
    window.api?.setBridgeDecision?.(props.initialData.downloadId, 'cancelled')
  }
  visible.value = false
}
</script>

<style scoped>
.dir-picker-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.threads-slider {
  flex: 1;
}

.preset-btns {
  display: flex;
  gap: 6px;
}

.preset-tag {
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 10px;
  font-weight: 600;
  transition: all var(--transition-fast);
}

.preset-tag:hover {
  opacity: 0.85;
}

.preset-tag.active {
  background-color: var(--accent-color);
  color: #ffffff;
}

.adv-collapse {
  margin-top: 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.adv-collapse :deep(.el-collapse-item__header) {
  padding: 0 12px;
  background-color: transparent;
  color: var(--text-secondary);
}

.adv-collapse :deep(.el-collapse-item__content) {
  padding: 12px;
}

.submit-btn {
  background: var(--accent-gradient) !important;
  border: none !important;
  font-weight: 600;
  padding: 10px 20px;
}
</style>
