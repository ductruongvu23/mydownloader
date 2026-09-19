import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import fs from 'fs'

const dir = process.cwd()
const token = process.argv[2] || process.env.GITHUB_TOKEN

if (!token) {
  console.log('\n❌ Chưa có GitHub Personal Access Token (PAT).')
  console.log('Cách sử dụng:')
  console.log('  node scripts/git-push.mjs <YOUR_GITHUB_PERSONAL_ACCESS_TOKEN>\n')
  process.exit(1)
}

async function push() {
  console.log('Đang đẩy mã nguồn lên https://github.com/ductruongvu23/mydownloader.git (branch: main)...')
  
  const res = await git.push({
    fs,
    http,
    dir,
    remote: 'origin',
    ref: 'main',
    onAuth: () => ({
      username: token,
      password: ''
    })
  })

  console.log('✅ Đã tải lên GitHub thành công!', res)
}

push().catch(err => {
  console.error('❌ Lỗi khi tải lên GitHub:', err.message || err)
  process.exit(1)
})
