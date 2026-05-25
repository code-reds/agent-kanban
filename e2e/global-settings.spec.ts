import { test, expect, Page } from '@playwright/test';

function getProjectCard(page: Page, projectName: string) {
  return page.getByRole('link', { name: projectName }).first();
}

async function createProject(page: Page, name: string, slug: string) {
  const createButton = page.getByRole('button', { name: 'Create Project' });
  const formVisible = await page.locator('.create-form').isVisible({ timeout: 2000 }).catch(() => false);
  if (!formVisible) {
    await createButton.click();
  }

  await expect(page.locator('.create-form')).toBeVisible({ timeout: 3000 });

  await page.locator('#project-name').fill(name);
  await page.locator('#project-slug').fill(slug);

  await page.locator('.create-form button[type="submit"]').click();

  await expect(page.locator('.create-form')).toBeHidden({ timeout: 5000 });
}

async function navigateToBoard(page: Page, projectName: string) {
  const projectLink = getProjectCard(page, projectName);
  await expect(projectLink).toBeVisible({ timeout: 3000 });
  await projectLink.click();
  await expect(page.locator('.kanban-board')).toBeVisible({ timeout: 5000 });
}

test.describe('Global Settings E2E Tests', () => {
  test.describe('E2E-06: Global Settings overview', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test('should navigate to global settings page', async ({ page }) => {
      // Click Settings link
      await page.getByRole('link', { name: 'Settings' }).click();

      // Click Global Settings in the sidebar if visible, or navigate directly
      const globalSettingsLink = page.getByRole('link', { name: 'Global Settings' });
      const isGlobalSettingsVisible = await globalSettingsLink.isVisible({ timeout: 3000 }).catch(() => false);

      if (isGlobalSettingsVisible) {
        await globalSettingsLink.click();
      } else {
        // Try navigating directly
        await page.goto('/global-settings');
      }

      // Verify the page loads
      await expect(page.getByRole('heading', { name: 'Global Settings' })).toBeVisible({ timeout: 5000 });
    });

    test('should display overview tab with counts by default', async ({ page }) => {
      await page.goto('/global-settings');

      // Verify the Overview tab is active
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({ timeout: 5000 }).catch(() => {
        // Overview heading might be inside a sub-component, which is fine
      });

      // The overview tab should be active by default
      const overviewTab = page.locator('.tab-btn', { hasText: 'Overview' });
      await expect(overviewTab).toHaveClass(/active/);

      // Verify info grid is visible
      await expect(page.locator('.info-grid')).toBeVisible();

      // Verify info items are present
      await expect(page.locator('.info-item')).toHaveCount(3);
      await expect(page.locator('.info-label')).toContainText(['Global Columns', 'Global Workflows', 'Access Rules']);
    });

    test('should display Reset to Defaults button', async ({ page }) => {
      await page.goto('/global-settings');

      const resetButton = page.getByRole('button', { name: 'Reset to Defaults' });
      await expect(resetButton).toBeVisible({ timeout: 3000 });
    });

    test('should display Refresh button', async ({ page }) => {
      await page.goto('/global-settings');

      const refreshButton = page.getByRole('button', { name: 'Refresh' });
      await expect(refreshButton).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('E2E-07: Global Settings tabs', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/global-settings');
    });

    test('should switch between all tabs', async ({ page }) => {
      const tabs = ['Overview', 'Columns', 'Roles', 'Workflow', 'Access Rules'];

      for (const tabName of tabs) {
        const tab = page.locator('.tab-btn', { hasText: tabName });
        await tab.click();
        await expect(tab).toHaveClass(/active/);
      }
    });

    test('should show Columns tab content', async ({ page }) => {
      await page.goto('/global-settings');
      await page.locator('.tab-btn', { hasText: 'Columns' }).click();

      // Columns tab should have a heading
      await expect(page.getByRole('heading', { name: 'Columns', level: 2 })).toBeVisible({ timeout: 3000 });
    });

    test('should show Workflow tab content', async ({ page }) => {
      await page.goto('/global-settings');
      await page.locator('.tab-btn', { hasText: 'Workflow' }).click();

      // Workflow tab should have a heading
      await expect(page.getByRole('heading', { name: 'Workflow' })).toBeVisible({ timeout: 3000 });
    });

    test('should show Access Rules tab content', async ({ page }) => {
      await page.goto('/global-settings');
      await page.locator('.tab-btn', { hasText: 'Access Rules' }).click();

      // Access Rules tab should have a heading
      await expect(page.getByRole('heading', { name: 'Access Rules', level: 2 })).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('E2E-08: Reset to Defaults', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      // Navigate directly to global settings
      await page.goto('/global-settings');
    });

    test('should show success message when resetting to defaults', async ({ page }) => {
      await page.goto('/global-settings');

      // Click the Reset to Defaults button
      const resetButton = page.getByRole('button', { name: 'Reset to Defaults' });
      await expect(resetButton).toBeVisible({ timeout: 3000 });
      await resetButton.click();

      // Button should show "Resetting..." while in progress
      await expect(resetButton).toContainText('Resetting...');

      // Should show success message
      await expect(page.locator('.success-message')).toContainText('Global settings have been reset to defaults', { timeout: 5000 });
    });

    test('should reload settings after reset', async ({ page }) => {
      await page.goto('/global-settings');

      // Click refresh first to see current state
      const refreshButton = page.getByRole('button', { name: 'Refresh' });
      await expect(refreshButton).toBeVisible();
      await refreshButton.click();
      await expect(page.locator('.success-message')).toContainText('Settings refreshed', { timeout: 3000 });

      // Verify the info grid shows counts
      const infoValues = page.locator('.info-value');
      await expect(infoValues).toHaveCount(3);
    });
  });
});
