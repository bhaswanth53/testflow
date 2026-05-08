const express = require('express');
const router = express.Router({ mergeParams: true });
const { getDb } = require('../utils/db');

function ctx(db, pSlug, rSlug) {
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(pSlug);
  if (!project) return null;
  const repo = db.prepare('SELECT * FROM repositories WHERE project_id = ? AND slug = ?').get(project.id, rSlug);
  if (!repo) return null;
  return { project, repo };
}

// New run form
router.get('/new', (req, res) => {
  const db = getDb();
  const c = ctx(db, req.params.projectSlug, req.params.repoSlug);
  if (!c) { db.close(); return res.redirect('/'); }

  const plans = db.prepare('SELECT * FROM test_plans WHERE repository_id = ? AND status = ? ORDER BY name').all(c.repo.id, 'active');
  const testCases = db.prepare(`
    SELECT tc.*, tg.name as group_name FROM test_cases tc
    LEFT JOIN test_groups tg ON tg.id = tc.group_id
    WHERE tc.repository_id = ? AND tc.status != 'deprecated'
    ORDER BY tc.group_id, tc.priority, tc.title
  `).all(c.repo.id);
  const groups = db.prepare('SELECT * FROM test_groups WHERE repository_id = ? ORDER BY name').all(c.repo.id);
  db.close();

  const ungroupedCases = testCases.filter(c => c.group_id === null || c.group_id === undefined);
  const groupedCases = groups.map(g => ({
    id: g.id, name: g.name,
    cases: testCases.filter(c => String(c.group_id) === String(g.id))
  })).filter(g => g.cases.length > 0);

  res.render('testruns/new', { project: c.project, repo: c.repo, plans, testCases, groups, ungroupedCases, groupedCases, title: 'New Test Run' });
});

// Create run
router.post('/', (req, res) => {
  const db = getDb();
  const c = ctx(db, req.params.projectSlug, req.params.repoSlug);
  if (!c) { db.close(); return res.redirect('/'); }

  const { name, description, test_plan_id, test_url, environment, browser } = req.body;
  let caseIds = req.body.case_ids || [];
  if (!Array.isArray(caseIds)) caseIds = [caseIds];

  if (test_plan_id) {
    const planCases = db.prepare('SELECT test_case_id FROM test_plan_cases WHERE test_plan_id = ?').all(test_plan_id);
    caseIds = planCases.map(r => r.test_case_id.toString());
  }

  const runId = db.prepare('INSERT INTO test_runs (repository_id, test_plan_id, name, description, test_url, environment, browser) VALUES (?,?,?,?,?,?,?) RETURNING id')
    .get(c.repo.id, test_plan_id || null, name, description || null, test_url || null, environment || null, browser || null).id;

  const insertResult = db.prepare('INSERT OR IGNORE INTO test_run_results (test_run_id, test_case_id) VALUES (?,?)');
  caseIds.forEach(id => insertResult.run(runId, id));

  db.close();
  res.redirect(`/projects/${req.params.projectSlug}/repos/${req.params.repoSlug}/runs/${runId}`);
});

// Show run
router.get('/:runId', (req, res) => {
  const db = getDb();
  const c = ctx(db, req.params.projectSlug, req.params.repoSlug);
  if (!c) { db.close(); return res.status(404).render('404', { title: 'Not Found' }); }

  const run = db.prepare(`
    SELECT tr.*, tp.name as plan_name
    FROM test_runs tr LEFT JOIN test_plans tp ON tp.id = tr.test_plan_id
    WHERE tr.id = ? AND tr.repository_id = ?
  `).get(req.params.runId, c.repo.id);
  if (!run) { db.close(); return res.status(404).render('404', { title: 'Not Found' }); }

  const results = db.prepare(`
    SELECT trr.*, tc.title, tc.priority, tc.type, tc.url, tc.description as case_description,
           tc.steps, tc.expected_result, tg.name as group_name
    FROM test_run_results trr
    JOIN test_cases tc ON tc.id = trr.test_case_id
    LEFT JOIN test_groups tg ON tg.id = tc.group_id
    WHERE trr.test_run_id = ?
    ORDER BY tg.name, tc.priority, tc.title
  `).all(run.id);

  results.forEach(r => {
    r.notes = db.prepare('SELECT * FROM test_run_notes WHERE test_run_result_id = ? ORDER BY created_at').all(r.id);
  });

  const runNotes = db.prepare('SELECT * FROM test_run_run_notes WHERE test_run_id = ? ORDER BY created_at').all(run.id);

  const statusCounts = {
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    blocked: results.filter(r => r.status === 'blocked').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    pending: results.filter(r => r.status === 'pending').length,
  };

  db.close();
  res.render('testruns/show', { project: c.project, repo: c.repo, run, results, runNotes, statusCounts, title: run.name });
});

// PDF export
router.get('/:runId/pdf', (req, res) => {
  const db = getDb();
  const c = ctx(db, req.params.projectSlug, req.params.repoSlug);
  if (!c) { db.close(); return res.status(404).send('Not found'); }

  const run = db.prepare(`
    SELECT tr.*, tp.name as plan_name
    FROM test_runs tr LEFT JOIN test_plans tp ON tp.id = tr.test_plan_id
    WHERE tr.id = ? AND tr.repository_id = ?
  `).get(req.params.runId, c.repo.id);
  if (!run) { db.close(); return res.status(404).send('Not found'); }

  const results = db.prepare(`
    SELECT trr.*, tc.title, tc.priority, tc.type, tc.url, tc.description as case_description,
           tc.steps, tc.expected_result, tg.name as group_name
    FROM test_run_results trr
    JOIN test_cases tc ON tc.id = trr.test_case_id
    LEFT JOIN test_groups tg ON tg.id = tc.group_id
    WHERE trr.test_run_id = ?
    ORDER BY tg.name, tc.priority, tc.title
  `).all(run.id);

  results.forEach(r => {
    r.notes = db.prepare('SELECT * FROM test_run_notes WHERE test_run_result_id = ? ORDER BY created_at').all(r.id);
  });

  const runNotes = db.prepare('SELECT * FROM test_run_run_notes WHERE test_run_id = ? ORDER BY created_at').all(run.id);

  const statusCounts = {
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    blocked: results.filter(r => r.status === 'blocked').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    pending: results.filter(r => r.status === 'pending').length,
  };

  db.close();
  res.render('testruns/pdf', { project: c.project, repo: c.repo, run, results, runNotes, statusCounts, layout: false, title: run.name });
});

// Update result status
router.post('/:runId/results/:resultId/status', (req, res) => {
  const { status } = req.body;
  const db = getDb();
  db.prepare('UPDATE test_run_results SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.resultId);
  db.close();
  res.json({ ok: true });
});

// Add per-case note
router.post('/:runId/results/:resultId/notes', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const db = getDb();
  const noteId = db.prepare('INSERT INTO test_run_notes (test_run_result_id, content) VALUES (?,?) RETURNING id').get(req.params.resultId, content).id;
  const note = db.prepare('SELECT * FROM test_run_notes WHERE id = ?').get(noteId);
  db.close();
  res.json({ ok: true, note });
});

// Update per-case note
router.post('/:runId/results/:resultId/notes/:noteId/edit', (req, res) => {
  const { content } = req.body;
  const db = getDb();
  db.prepare('UPDATE test_run_notes SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, req.params.noteId);
  db.close();
  res.json({ ok: true });
});

// Delete per-case note
router.post('/:runId/results/:resultId/notes/:noteId/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM test_run_notes WHERE id=?').run(req.params.noteId);
  db.close();
  res.json({ ok: true });
});

// Add run-level note
router.post('/:runId/run-notes', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const db = getDb();
  const noteId = db.prepare('INSERT INTO test_run_run_notes (test_run_id, content) VALUES (?,?) RETURNING id').get(req.params.runId, content).id;
  const note = db.prepare('SELECT * FROM test_run_run_notes WHERE id = ?').get(noteId);
  db.close();
  res.json({ ok: true, note });
});

// Update run-level note
router.post('/:runId/run-notes/:noteId/edit', (req, res) => {
  const { content } = req.body;
  const db = getDb();
  db.prepare('UPDATE test_run_run_notes SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, req.params.noteId);
  db.close();
  res.json({ ok: true });
});

// Delete run-level note
router.post('/:runId/run-notes/:noteId/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM test_run_run_notes WHERE id=?').run(req.params.noteId);
  db.close();
  res.json({ ok: true });
});

// Complete/abort run
router.post('/:runId/status', (req, res) => {
  const { status } = req.body;
  const db = getDb();
  const c = ctx(db, req.params.projectSlug, req.params.repoSlug);
  if (!c) { db.close(); return res.redirect('/'); }
  const completedAt = (status === 'completed' || status === 'aborted') ? new Date().toISOString() : null;
  db.prepare('UPDATE test_runs SET status=?, updated_at=CURRENT_TIMESTAMP, completed_at=? WHERE id=?').run(status, completedAt, req.params.runId);
  db.close();
  res.redirect(`/projects/${req.params.projectSlug}/repos/${req.params.repoSlug}/runs/${req.params.runId}`);
});

// Delete run
router.post('/:runId/delete', (req, res) => {
  const db = getDb();
  const c = ctx(db, req.params.projectSlug, req.params.repoSlug);
  if (c) db.prepare('DELETE FROM test_runs WHERE id=? AND repository_id=?').run(req.params.runId, c.repo.id);
  db.close();
  res.redirect(`/projects/${req.params.projectSlug}/repos/${req.params.repoSlug}`);
});

module.exports = router;