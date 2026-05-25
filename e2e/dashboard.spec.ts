import { test, expect } from '@playwright/test';

function getProjectCard(page, projectName) {
  return page.getByRole('link', { name: projectName }).first();
}

async function createProject(page, name, slug) {
  // Ensure create form is visible
  const createButton = page.getByRole('button', { name: 'Create Project' });
  const formVisible = await page.locator('.create-form').isVisible({ timeout: 2000 }).catch(() => false);
  if (!formVisible) {
    await createButton.click();
  }

  // Wait for the form to be visible
  await expect(page.locator('.create-form')).toBeVisible({ timeout: 3000 });

  // Fill in the form
  await page.locator('#project-name').fill(name);
  await page.locator('#project-slug').fill(slug);

  // Submit the form
  await page.locator('.create-form button[type="submit"]').click();

  // Wait for the form to close (it disappears on success)
  await expect(page.locator('.create-form')).toBeHidden({ timeout: 5000 });
}

test.describe('Dashboard E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the dashboard page', async ({ page }) => {
    await expect(page).toHaveTitle(/Agent Kanban/);
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('should display create project form', async ({ page }) => {
    const createButton = page.getByRole('button', { name: 'Create Project' });
    await expect(createButton).toBeVisible();

    await createButton.click();

    await expect(page.locator('#project-name')).toBeVisible();
    await expect(page.locator('#project-slug')).toBeVisible();
  });

  test('should validate project creation form', async ({ page }) => {
    const createButton = page.getByRole('button', { name: 'Create Project' });
    await createButton.click();

    await expect(page.locator('.create-form')).toBeVisible({ timeout: 3000 });

    // Try to submit empty form
    await page.locator('.create-form button[type="submit"]').click();

    // Should show validation errors
    await expect(page.locator('.form-error')).toBeVisible({ timeout: 3000 });
  });

  test('should auto-generate slug from name', async ({ page }) => {
    const createButton = page.getByRole('button', { name: 'Create Project' });
    await createButton.click();

    await expect(page.locator('.create-form')).toBeVisible({ timeout: 3000 });

    const nameInput = page.locator('#project-name');
    await nameInput.fill('My Test Project');

    // Wait for auto-generated slug (watchEffect runs)
    await page.waitForTimeout(300);

    const slugInput = page.locator('#project-slug');
    const slugValue = await slugInput.inputValue();
    expect(slugValue).toContain('my');
    expect(slugValue).toContain('test');
    expect(slugValue).toContain('project');
  });

  test('E2E-01: Dashboard -> Project Board (verify 7 columns)', async ({ page }) => {
    // 1. Go to dashboard (already done in beforeEach)

    // 2. Create a project with name "E2E Board Test" / slug "e2e-board-test"
    await createProject(page, 'E2E Board Test', 'e2e-board-test');

    // Wait for project card to appear
    await expect(page.locator('.project-card')).toBeVisible({ timeout: 5000 });

    // 3. Navigate to the project board
    const projectLink = getProjectCard(page, 'E2E Board Test');
    await expect(projectLink).toBeVisible({ timeout: 3000 });
    await projectLink.click();

    // Wait for board route
    await expect(page).toHaveURL(/\/projects\/e2e-board-test\/board/, { timeout: 5000 });

    // 4. Verify the board shows 7 default columns
    const columnNames = [
      'human_feedback',
      'todo',
      'implementation',
      'unit_review',
      'integration_testing',
      'final_review',
      'done',
    ];

    for (const columnName of columnNames) {
      const column = page.locator('.kanban-column').filter({ hasText: columnName });
      await expect(column).toBeVisible({ timeout: 5000 });
    }
  });
});
