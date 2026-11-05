import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // 绑到 0.0.0.0，同一内网的手机、另一台电脑可以直接打开
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
});
