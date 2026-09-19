import git from 'isomorphic-git'
import fs from 'fs'
import path from 'path'

const dir = process.cwd()

async function main() {
  console.log('--- Initializing Git Repository in:', dir)
  
  // 1. Initialize git
  await git.init({ fs, dir, defaultBranch: 'main' })
  console.log('Git repo initialized with default branch "main"')

  // 2. Read gitignore patterns
  const statusMatrix = await git.statusMatrix({ fs, dir })
  console.log(`Found ${statusMatrix.length} tracked/untracked entries`)

  // 3. Stage all files (where file is untracked or modified)
  let stagedCount = 0
  for (const [filepath, head, workdir, stage] of statusMatrix) {
    // If file exists in workdir and not staged or modified
    if (workdir === 1 || workdir === 2) {
      await git.add({ fs, dir, filepath })
      stagedCount++
    }
  }
  console.log(`Staged ${stagedCount} files`)

  // 4. Commit
  const sha = await git.commit({
    fs,
    dir,
    message: 'Initial commit: MyDownloader - High-Speed Multi-Threaded Download Manager',
    author: {
      name: 'ductruongvu23',
      email: 'ductruongvu23@users.noreply.github.com'
    }
  })
  console.log('Committed successfully with SHA:', sha)

  // 5. Add remote origin
  await git.addRemote({
    fs,
    dir,
    remote: 'origin',
    url: 'https://github.com/ductruongvu23/mydownloader.git',
    force: true
  })
  console.log('Remote "origin" added: https://github.com/ductruongvu23/mydownloader.git')

  // Check current branch and remotes
  const remotes = await git.listRemotes({ fs, dir })
  const currentBranch = await git.currentBranch({ fs, dir })
  console.log('Current branch:', currentBranch)
  console.log('Remotes:', remotes)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
