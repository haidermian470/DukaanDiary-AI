
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Use the correct asset path for each deployment
export default defineConfig({
  plugins: [react()],
  base: process.env.VERCEL ? '/' : '/DukaanDiary-AI/',
})
