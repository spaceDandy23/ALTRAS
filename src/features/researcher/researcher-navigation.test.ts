// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(resolve('src/app/App.tsx'), 'utf8');
const layout = readFileSync(resolve('src/features/researcher/ResearcherLayout.tsx'), 'utf8');

describe('researcher report navigation retirement', () => {
  it('removes Reports navigation while retaining the primary research pages', () => {
    expect(layout).not.toContain("label: 'Reports'");
    for (const label of ['Dashboard', 'Participants', 'Assessments', 'Lessons'])
      expect(layout).toContain(`label: '${label}'`);
  });

  it('redirects the old bookmarked Reports route to the dashboard', () => {
    expect(app).toContain(
      '<Route path="reports" element={<Navigate to="/researcher" replace />} />',
    );
    expect(app).not.toContain('ResearcherReportsPage');
  });
});
