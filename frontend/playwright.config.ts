import { defineConfig } from '@playwright/test'

const python = process.env.PYTHON ?? 'python'
const data = process.env.E2E_DATA ?? '../.e2e-data'

/** Real backend, real built frontend, fake users-api. Run `npm run build` first. */
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  timeout: 45_000,
  workers: 1,
  reporter: 'line',
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:8099', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    {
      command: `${python} -m uvicorn fake_users_api:app --port 8098 --log-level warning`,
      cwd: './e2e',
      url: 'http://127.0.0.1:8098/api/health',
      reuseExistingServer: false,
    },
    {
      command: `${python} -m alembic upgrade head && ${python} -m uvicorn app.main:create_app --factory --port 8099 --log-level warning`,
      cwd: '../backend',
      url: 'http://127.0.0.1:8099/api/healthz',
      reuseExistingServer: false,
      env: {
        DATA_DIR: data,
        FRONTEND_DIST: '../frontend/dist',
        USERS_API_URL: 'http://127.0.0.1:8098',
        LOGIN_RATE_LIMIT: '1000',
        FORUM_RATE_LIMIT: '1000',
        PUBLIC_RATE_LIMIT: '1000',
        HEALTH_TTL: '1',
        ADMIN_USERS: 'moderator',
      },
    },
  ],
})
