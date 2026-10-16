import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backendDir = resolve(frontendDir, '..', 'backend')
function runNpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    })
  }
  return spawn('npm', args, { cwd, stdio: 'inherit' })
}

const processes = [
  runNpm(['run', 'dev'], backendDir),
  runNpm(['run', 'dev:web'], frontendDir),
]

let stopping = false
function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) {
    if (!child.killed) child.kill('SIGINT')
  }
  setTimeout(() => process.exit(exitCode), 500)
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error('Could not start a NavGo development server:', error.message)
    stopAll(1)
  })
  child.on('exit', (code) => {
    if (!stopping && code !== 0) stopAll(code || 1)
  })
}

process.once('SIGINT', () => stopAll(0))
process.once('SIGTERM', () => stopAll(0))
