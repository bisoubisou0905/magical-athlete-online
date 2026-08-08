import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], peer: ['peerjs'] }
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '魔法运动会 Online',
        short_name: '魔法运动会',
        description: '四人线上混乱赛跑桌游',
        theme_color: '#17131c',
        background_color: '#17131c',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'] }
    })
  ]
});
