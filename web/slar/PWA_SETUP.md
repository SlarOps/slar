# PWA Setup Complete

The AI Agent page has been successfully converted to a Progressive Web App (PWA).

## What's Included

### 1. Generated Icons
All PWA icons have been generated in `public/`:
- icon-72x72.png
- icon-96x96.png
- icon-128x128.png
- icon-144x144.png
- icon-152x152.png (Apple Touch Icon)
- icon-192x192.png (Android)
- icon-384x384.png
- icon-512x512.png (Android splash)

### 2. Manifest Configuration
`public/manifest.json` includes:
- App name: "SLAR AI Agent"
- Start URL: `/ai-agent`
- Display mode: standalone
- Theme color: #2563eb (blue)
- App shortcuts (New Chat, Incidents)

### 3. Service Worker
`public/sw.js` implements:
- Network-first strategy for API calls
- Cache-first strategy for static assets
- Offline fallback support
- Auto-cleanup of old caches

### 4. Install Prompt
`src/components/PWAInstallPrompt.js`:
- Custom install UI with gradient design
- Service worker registration
- Dismiss persistence (7 days)
- Update detection and reload prompt

## Testing the PWA

### 1. Start Development Server
```bash
cd web/slar
npm run dev
```

### 2. Test in Chrome
1. Open http://localhost:3000/ai-agent
2. Open DevTools (F12) → Application tab
3. Check:
   - **Manifest**: Verify all icons load
   - **Service Workers**: Check registration status
   - **Storage**: Verify caches are created

### 3. Test Install Prompt
1. Chrome will show install banner automatically
2. Or click the install icon in address bar
3. Follow prompt to install app

### 4. Test Offline Mode
1. Install the PWA
2. Open installed app
3. In DevTools → Network tab, enable "Offline"
4. Navigate pages - static assets should load from cache
5. API calls will show offline message

### 5. Test on Mobile (Android)
1. Deploy to production or use ngrok for HTTPS
2. Open in Chrome mobile
3. Tap "Add to Home Screen" when prompted
4. App will install with icon on home screen

### 6. Test on Mobile (iOS)
1. Open in Safari
2. Tap Share button → "Add to Home Screen"
3. Note: iOS doesn't support install prompt API

## Production Deployment

### Build and Deploy
```bash
cd web/slar

# Build Next.js
npm run build

# Build Docker image
docker build -f Dockerfile.simple --platform linux/amd64 -t slar-web .

# Or use dev.sh
cd ../../deploy/docker
./dev.sh build web
```

### Verify in Production
1. Open production URL with HTTPS (required for PWA)
2. Check manifest: https://your-domain.com/manifest.json
3. Check service worker registration
4. Test install prompt

## Requirements for PWA

✅ **Completed:**
- [x] Manifest file with required fields
- [x] Icons in multiple sizes
- [x] Service worker registration
- [x] HTTPS in production (Kubernetes ingress handles this)
- [x] Start URL configured
- [x] Display mode set to standalone

⚠️ **Optional Improvements:**
- [ ] Add screenshots (screenshot-mobile.png, screenshot-desktop.png)
- [ ] Replace placeholder icon with branded design
- [ ] Add more offline fallback pages
- [ ] Implement background sync for offline actions

## Customizing Icons

To replace the placeholder icon with your own design:

### Option 1: Use Online Tool
1. Visit https://www.pwabuilder.com/imageGenerator
2. Upload your 512x512 logo
3. Download generated icons
4. Replace files in `public/`

### Option 2: Update SVG and Regenerate
1. Edit `public/icon.svg` with your design
2. Run icon generator:
   ```bash
   node generate-icons.js
   ```

### Option 3: Use ImageMagick
```bash
cd public
# Create your base icon as icon-base.png (512x512)
magick icon-base.png -resize 192x192 icon-192x192.png
# Repeat for all sizes
```

## Troubleshooting

### Service Worker Not Registering
- Check console for errors
- Ensure HTTPS in production (required for service workers)
- Clear browser cache and reload

### Install Prompt Not Showing
- PWA criteria must be met (manifest, service worker, HTTPS)
- User may have already dismissed the prompt
- Check localStorage for 'pwa-install-dismissed'
- Try different browser or incognito mode

### Icons Not Loading
- Verify files exist: `ls -lh public/icon-*.png`
- Check manifest.json paths are correct
- Clear cache and hard reload (Cmd+Shift+R)

### Offline Mode Not Working
- Check service worker is active (DevTools → Application → Service Workers)
- Verify cache storage (DevTools → Application → Cache Storage)
- Check network tab - resources should show "from ServiceWorker"

## Resources

- [PWA Builder](https://www.pwabuilder.com/)
- [Web.dev PWA Guide](https://web.dev/progressive-web-apps/)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Next.js PWA Plugin](https://github.com/shadowwalker/next-pwa)

## Next Steps

1. **Test locally**: Start dev server and verify PWA installation works
2. **Deploy to production**: Build Docker image and deploy
3. **Test on mobile**: Install on Android/iOS devices
4. **Customize icons**: Replace placeholder with branded design
5. **Add screenshots**: Create mobile and desktop screenshots for better app listing
