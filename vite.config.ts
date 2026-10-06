import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // phone/ is its own Expo project with its own dependencies and tests
  test: { exclude: [...configDefaults.exclude, 'phone/**'] },
})
