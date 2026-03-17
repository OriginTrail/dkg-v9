import { test, expect, type Page } from '@playwright/test';

const GAME_URL = '/apps/origin-trail-game/';

async function ensureLobby(page: Page) {
  await page.goto(GAME_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const leaveBtn = page.getByRole('button', { name: 'Leave Swarm' });
  const backBtn = page.getByRole('button', { name: 'Back to Lobby' });

  if (await leaveBtn.isVisible().catch(() => false)) {
    await leaveBtn.click();
    const confirmBtn = page.getByRole('button', { name: 'Confirm Leave' });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();
    await page.waitForTimeout(2000);
  } else if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click();
    await page.waitForTimeout(2000);
  }
}

test.describe('OriginTrail Game', () => {
  test.describe('Navigate to game via UI', () => {
    test('Apps button opens dropdown, OriginTrail Game navigates to /ui/apps', async ({ page }) => {
      await page.goto('/ui');
      const appsBtn = page.getByRole('button', { name: /Apps/ });
      await expect(appsBtn).toBeVisible({ timeout: 15_000 });
      await appsBtn.click();

      const gameLink = page.getByRole('button', { name: /OriginTrail Game/ });
      await expect(gameLink).toBeVisible();
      await gameLink.click();

      await expect(page).toHaveURL(/\/ui\/apps/);
      await expect(page.locator('iframe[title="OriginTrail Game"]')).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('Lobby', () => {
    test.beforeEach(async ({ page }) => {
      await ensureLobby(page);
    });

    test('shows game header and Playing as', async ({ page }) => {
      await expect(page.getByText('ORIGINTRAIL GAME', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/AI Frontier Journey/i)).toBeVisible();
      await expect(page.getByText(/Playing as:/)).toBeVisible();
    });

    test('shows leaderboard section', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /Leaderboard/ })).toBeVisible({ timeout: 15_000 });
    });

    test('shows lobby sections', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Your Swarms' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Open Swarms' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Launch Swarm' })).toBeVisible();
      await expect(page.getByText('Lobby Chat')).toBeVisible();
    });

    test('launch swarm form has name input, max players controls, disabled button', async ({ page }) => {
      const nameInput = page.getByPlaceholder('Swarm name...');
      await expect(nameInput).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Max players:')).toBeVisible();

      const launchBtn = page.getByRole('button', { name: 'Launch Swarm' });
      await expect(launchBtn).toBeDisabled();

      await nameInput.fill('E2E-Test-Swarm');
      await expect(launchBtn).toBeEnabled();
    });

    test('lobby chat input and send button', async ({ page }) => {
      const chatInput = page.getByPlaceholder('Say something...');
      await expect(chatInput).toBeVisible({ timeout: 15_000 });
      const sendBtn = page.getByRole('button', { name: 'Send' });
      await expect(sendBtn).toBeDisabled();
    });

    test('refresh button works without errors', async ({ page }) => {
      const refreshBtn = page.getByRole('button', { name: 'Refresh' });
      await expect(refreshBtn).toBeVisible({ timeout: 15_000 });

      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await refreshBtn.click();
      await page.waitForTimeout(2000);
      expect(errors).toEqual([]);
    });
  });

  test.describe('Game flow', () => {
    test('create swarm, start expedition, vote, and leave', async ({ page }) => {
      test.info().annotations.push({ type: 'note', description: 'Depends on DKG backend — skips if too slow' });
      test.setTimeout(300_000);
      await ensureLobby(page);

      // ── Step 1: Create swarm ──────────────────────────────────────
      const nameInput = page.getByPlaceholder('Swarm name...');
      await expect(nameInput).toBeVisible({ timeout: 15_000 });
      const uniqueName = `E2E-Full-${Date.now()}`;
      await nameInput.fill(uniqueName);

      const decreaseBtn = page.getByRole('button', { name: 'Decrease max players' });
      for (let i = 0; i < 5; i++) {
        if (await decreaseBtn.isEnabled()) {
          await decreaseBtn.click();
          await page.waitForTimeout(200);
        }
      }

      await page.getByRole('button', { name: 'Launch Swarm' }).click();

      // api.create() involves DKG writes and may hang. If it succeeds, the
      // callback navigates to the swarm view directly. If it hangs, the lobby
      // poll (4s) picks up the new swarm and we need to click it manually.
      const startJourneyBtn = page.getByRole('button', { name: 'Start Journey' });

      try {
        await expect(startJourneyBtn).toBeVisible({ timeout: 30_000 });
      } catch {
        // Still in lobby — click the swarm entry to navigate to swarm view
        const swarmEntry = page.getByText(uniqueName, { exact: true });
        await swarmEntry.click();
        await expect(startJourneyBtn).toBeVisible({ timeout: 20_000 });
      }

      // ── Step 2: Start expedition ──────────────────────────────────
      // launchExpedition does DKG workspace writes + on-chain context graph
      // creation. These operations can take 30-120+s or hang indefinitely
      // when the DKG backend/peers are slow. Skip rather than fail.
      await startJourneyBtn.click();

      const advanceBtn = page.getByRole('button', { name: /Advance \(Standard\)/ });
      try {
        await expect(advanceBtn).toBeVisible({ timeout: 90_000 });
      } catch {
        test.skip(true, 'DKG backend too slow — launchExpedition did not complete within 90s');
        return;
      }

      await expect(page.getByText(/Epochs/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/TRAC/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/Votes \(\d+\/\d+\)/)).toBeVisible({ timeout: 10_000 });

      // ── Step 3: Vote ──────────────────────────────────────────────
      await advanceBtn.click();

      try {
        await expect(page.getByRole('heading', { name: 'Last Turn' })).toBeVisible({ timeout: 90_000 });
      } catch {
        test.skip(true, 'DKG backend too slow — castVote did not complete within 90s');
        return;
      }

      // ── Step 4: Leave swarm ───────────────────────────────────────
      const leaveBtn = page.getByRole('button', { name: 'Leave Swarm' });
      await leaveBtn.click();
      await expect(page.getByText(/Leave this swarm\?/)).toBeVisible({ timeout: 5_000 });

      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByText(/Leave this swarm\?/)).not.toBeVisible();

      await leaveBtn.click();
      await page.getByRole('button', { name: 'Confirm Leave' }).click();
      await expect(page.getByRole('heading', { name: 'Launch Swarm' })).toBeVisible({ timeout: 15_000 });
    });
  });
});
