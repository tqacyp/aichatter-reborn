import { defineConfig } from 'vite'

export default defineConfig({
  // 确保正确处理markdown文件
  assetsInclude: ['**/*.md'],
  // 优化预构建
  optimizeDeps: {
    include: ['marked', 'katex']
  },
  // 开发服务器配置
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000/',
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  }
})