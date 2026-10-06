# Garanti Kuluçka Beta Panel (`@garanti-kulucka/web-beta`)

Mevcut panelden (`apps/web`) bağımsız, sıfırdan yazılmış beta arayüz: Vite + React + TypeScript +
Tailwind v4 + shadcn/ui (Radix), lucide-react, react-router, react-i18next (TR varsayılan, EN) ve
vite-plugin-pwa. Yan menü yoktur; masaüstünde üst menü, mobilde hamburger Sheet menü ve alt gezinme
çubuğu kullanılır.

## Yerelde çalıştırma

```sh
npm ci
npm run build -w @garanti-kulucka/shared
npm run dev -w @garanti-kulucka/web-beta      # http://localhost:5174, /backend -> http://127.0.0.1:3000
```

API adresi `VITE_BACKEND_BASE_URL` ile ayarlanır (varsayılan `/backend`; Docker'da nginx bu yolu `api:3000`'e
yönlendirir).

## Docker / compose

```sh
docker compose up --build beta-frontend       # http://localhost:8081 (mevcut panel 8080'de kalır)
```

## Testler

```sh
npm run test:unit -w @garanti-kulucka/web-beta   # vitest: i18n, rol menüsü, API istemcisi, yardımcılar
npm run test:e2e:beta                            # Playwright (tests/playwright-beta, *.beta.ts)
```

Service worker yalnızca statik dosyaları önbelleğe alır; API istekleri (`/backend`, `/api`, `/auth`, `/admin`)
hiçbir zaman önbellekten verilmez.
