import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages(https://<user>.github.io/bingo/)처럼 하위 경로에 올려도 동작하게 상대 경로 사용
  base: './',
});
