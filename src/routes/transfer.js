const express = require('express');
const router = express.Router();
const { getDb } = require('../utils/db');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '../../public/images/uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

function extractImagePaths(html) {
  if (!html) return [];
  var paths = [], re = /\/images\/uploads\/([^"'\s<>]+)/g, m;
  while ((m = re.exec(html)) !== null) paths.push(m[1]);
  return paths;
}

function rewriteImagePaths(html, map) {
  if (!html) return html;
  return html.replace(/\/images\/uploads\/([^"'\s<>]+)/g, function(_, fname) {
    return '/images/uploads/' + (map[fname] || fname);
  });
}

function toSlug(text) {
  return (text || 'export').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
}

function uniqueSlug(db, table, slug, extraWhere, extraParams) {
  extraWhere = extraWhere || ''; extraParams = extraParams || [];
  var candidate = slug, count = 0;
  while (true) {
    var row = db.prepare('SELECT id FROM ' + table + ' WHERE slug = ? ' + extraWhere).get([candidate].concat(extraParams));
    if (!row) return candidate;
    candidate = slug + '-' + (++count);
  }
}

function ids(arr) { return arr.map(function() { return '?'; }).join(','); }

function safeRun(fn) {
  try { return fn(); } catch(e) { return null; }
}

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/export', function(req, res) {
  var db = getDb();
  var type = req.query.type, id = req.query.id;
  var data = {}, imageFiles = [];

  function collectImages(html) {
    extractImagePaths(html).forEach(function(f) {
      if (imageFiles.indexOf(f) === -1) imageFiles.push(f);
    });
  }

  try {
    if (type === 'project') {
      var project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!project) { db.close(); return res.status(404).send('Project not found'); }
      var repos = db.prepare('SELECT * FROM repositories WHERE project_id = ?').all(id);
      var repoIds = repos.map(function(r) { return r.id; });
      var groups = [], cases = [], plans = [], planCases = [], runs = [], results = [], notes = [], runNotes = [];
      if (repoIds.length) {
        groups    = db.prepare('SELECT * FROM test_groups WHERE repository_id IN (' + ids(repoIds) + ')').all(repoIds);
        cases     = db.prepare('SELECT * FROM test_cases WHERE repository_id IN (' + ids(repoIds) + ')').all(repoIds);
        plans     = db.prepare('SELECT * FROM test_plans WHERE repository_id IN (' + ids(repoIds) + ')').all(repoIds);
        runs      = db.prepare('SELECT * FROM test_runs WHERE repository_id IN (' + ids(repoIds) + ')').all(repoIds);
        var planIds = plans.map(function(p) { return p.id; });
        var runIds  = runs.map(function(r)  { return r.id; });
        if (planIds.length) planCases = db.prepare('SELECT * FROM test_plan_cases WHERE test_plan_id IN (' + ids(planIds) + ')').all(planIds);
        if (runIds.length)  results   = db.prepare('SELECT * FROM test_run_results WHERE test_run_id IN (' + ids(runIds) + ')').all(runIds);
        var resultIds = results.map(function(r) { return r.id; });
        if (resultIds.length) notes    = db.prepare('SELECT * FROM test_run_notes WHERE test_run_result_id IN (' + ids(resultIds) + ')').all(resultIds);
        if (runIds.length)    runNotes = db.prepare('SELECT * FROM test_run_run_notes WHERE test_run_id IN (' + ids(runIds) + ')').all(runIds);
      }
      notes.forEach(function(n) { collectImages(n.content); });
      runNotes.forEach(function(n) { collectImages(n.content); });
      data = { type: 'project', project: project, repos: repos, groups: groups, cases: cases, plans: plans, planCases: planCases, runs: runs, results: results, notes: notes, runNotes: runNotes };

    } else if (type === 'repository') {
      var repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id);
      if (!repo) { db.close(); return res.status(404).send('Repository not found'); }
      var project2    = db.prepare('SELECT * FROM projects WHERE id = ?').get(repo.project_id);
      var groups2     = db.prepare('SELECT * FROM test_groups WHERE repository_id = ?').all(id);
      var cases2      = db.prepare('SELECT * FROM test_cases WHERE repository_id = ?').all(id);
      var plans2      = db.prepare('SELECT * FROM test_plans WHERE repository_id = ?').all(id);
      var runs2       = db.prepare('SELECT * FROM test_runs WHERE repository_id = ?').all(id);
      var planIds2    = plans2.map(function(p) { return p.id; });
      var runIds2     = runs2.map(function(r)  { return r.id; });
      var planCases2  = planIds2.length ? db.prepare('SELECT * FROM test_plan_cases WHERE test_plan_id IN (' + ids(planIds2) + ')').all(planIds2) : [];
      var results2    = runIds2.length  ? db.prepare('SELECT * FROM test_run_results WHERE test_run_id IN (' + ids(runIds2) + ')').all(runIds2) : [];
      var resultIds2  = results2.map(function(r) { return r.id; });
      var notes2      = resultIds2.length ? db.prepare('SELECT * FROM test_run_notes WHERE test_run_result_id IN (' + ids(resultIds2) + ')').all(resultIds2) : [];
      var runNotes2   = runIds2.length    ? db.prepare('SELECT * FROM test_run_run_notes WHERE test_run_id IN (' + ids(runIds2) + ')').all(runIds2) : [];
      notes2.forEach(function(n) { collectImages(n.content); });
      runNotes2.forEach(function(n) { collectImages(n.content); });
      data = { type: 'repository', repo: repo, projectName: project2 ? project2.name : '', groups: groups2, cases: cases2, plans: plans2, planCases: planCases2, runs: runs2, results: results2, notes: notes2, runNotes: runNotes2 };

    } else if (type === 'testcases') {
      var repo3   = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id);
      if (!repo3) { db.close(); return res.status(404).send('Repository not found'); }
      var cases3  = db.prepare('SELECT * FROM test_cases WHERE repository_id = ?').all(id);
      var gids3   = cases3.map(function(c) { return c.group_id; }).filter(Boolean);
      var ugids3  = gids3.filter(function(v, i, a) { return a.indexOf(v) === i; });
      var groups3 = ugids3.length ? db.prepare('SELECT * FROM test_groups WHERE id IN (' + ids(ugids3) + ')').all(ugids3) : [];
      data = { type: 'testcases', repoName: repo3.name, groups: groups3, cases: cases3 };

    } else if (type === 'testplan') {
      var plan    = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id);
      if (!plan)  { db.close(); return res.status(404).send('Plan not found'); }
      var repo4   = db.prepare('SELECT * FROM repositories WHERE id = ?').get(plan.repository_id);
      var pc4     = db.prepare('SELECT * FROM test_plan_cases WHERE test_plan_id = ?').all(id);
      var cids4   = pc4.map(function(pc) { return pc.test_case_id; });
      var cases4  = cids4.length ? db.prepare('SELECT * FROM test_cases WHERE id IN (' + ids(cids4) + ')').all(cids4) : [];
      var gids4   = cases4.map(function(c) { return c.group_id; }).filter(Boolean);
      var ugids4  = gids4.filter(function(v, i, a) { return a.indexOf(v) === i; });
      var groups4 = ugids4.length ? db.prepare('SELECT * FROM test_groups WHERE id IN (' + ids(ugids4) + ')').all(ugids4) : [];
      data = { type: 'testplan', plan: plan, repoName: repo4 ? repo4.name : '', groups: groups4, cases: cases4, planCases: pc4 };

    } else if (type === 'testrun') {
      var run     = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id);
      if (!run)   { db.close(); return res.status(404).send('Run not found'); }
      var repo5   = db.prepare('SELECT * FROM repositories WHERE id = ?').get(run.repository_id);
      var res5    = db.prepare('SELECT * FROM test_run_results WHERE test_run_id = ?').all(id);
      var rids5   = res5.map(function(r) { return r.id; });
      var cids5   = res5.map(function(r) { return r.test_case_id; });
      var notes5  = rids5.length ? db.prepare('SELECT * FROM test_run_notes WHERE test_run_result_id IN (' + ids(rids5) + ')').all(rids5) : [];
      var rnotes5 = db.prepare('SELECT * FROM test_run_run_notes WHERE test_run_id = ?').all(id);
      var cases5  = cids5.length ? db.prepare('SELECT * FROM test_cases WHERE id IN (' + ids(cids5) + ')').all(cids5) : [];
      notes5.forEach(function(n) { collectImages(n.content); });
      rnotes5.forEach(function(n) { collectImages(n.content); });
      data = { type: 'testrun', run: run, repoName: repo5 ? repo5.name : '', results: res5, notes: notes5, runNotes: rnotes5, cases: cases5 };

    } else {
      db.close(); return res.status(400).send('Invalid export type');
    }

    db.close();

    var entityName = toSlug(
      (data.project && data.project.name) ||
      (data.repo && data.repo.name) ||
      (data.plan && data.plan.name) ||
      (data.run && data.run.name) || type
    );
    var filename = 'testflow-' + type + '-' + entityName + '-' + Date.now() + '.testflow.zip';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    var archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', function(err) { console.error('Archive error:', err); });
    archive.pipe(res);
    archive.append(JSON.stringify({ version: '1.0', exportedAt: new Date().toISOString(), type: type }, null, 2), { name: 'manifest.json' });
    archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });
    imageFiles.forEach(function(fname) {
      var fpath = path.join(UPLOAD_DIR, fname);
      if (fs.existsSync(fpath)) archive.file(fpath, { name: 'images/' + fname });
    });
    archive.finalize();

  } catch (err) {
    console.error('Export error:', err);
    try { db.close(); } catch(e) {}
    if (!res.headersSent) res.status(500).send('Export failed: ' + err.message);
  }
});

// ── Import ────────────────────────────────────────────────────────────────────

router.post('/import', upload.single('file'), function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  var db = getDb();
  var target_project_id = req.body.target_project_id || null;
  var target_repo_id    = req.body.target_repo_id    || null;

  unzipper.Open.buffer(req.file.buffer).then(function(directory) {
    var dataEntry = directory.files.find(function(f) { return f.path === 'data.json'; });
    if (!dataEntry) { db.close(); return res.status(400).json({ error: 'Invalid file: missing data.json' }); }

    dataEntry.buffer().then(function(dataBuffer) {
      var data;
      try { data = JSON.parse(dataBuffer.toString('utf8')); }
      catch(e) { db.close(); return res.status(400).json({ error: 'Invalid data.json: ' + e.message }); }

      var imageEntries = directory.files.filter(function(f) {
        return f.path.startsWith('images/') && f.path.length > 'images/'.length;
      });
      var imageMap = {};
      var imagePromises = imageEntries.map(function(entry) {
        return entry.buffer().then(function(buf) {
          var originalName = path.basename(entry.path);
          var ext = path.extname(originalName);
          var newName = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;
          imageMap[originalName] = newName;
          if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          fs.writeFileSync(path.join(UPLOAD_DIR, newName), buf);
        });
      });

      Promise.all(imagePromises).then(function() {
        var groupIdMap = {}, caseIdMap = {}, planIdMap = {}, runIdMap = {}, resultIdMap = {};

        function importGroups(groups, repoId) {
          (groups || []).forEach(function(g) {
            var r = safeRun(function() {
              return db.prepare('INSERT INTO test_groups (repository_id,name,description) VALUES (?,?,?) RETURNING id')
                .get(repoId, g.name, g.description || null);
            });
            if (r) groupIdMap[g.id] = r.id;
          });
        }

        function importCases(cases, repoId) {
          (cases || []).forEach(function(c) {
            var newGroupId = c.group_id ? (groupIdMap[c.group_id] || null) : null;
            var r = safeRun(function() {
              return db.prepare('INSERT INTO test_cases (repository_id,group_id,title,description,url,priority,type,status,preconditions,steps,expected_result,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
                .get(repoId, newGroupId, c.title, c.description||null, c.url||null, c.priority||'medium', c.type||'functional', c.status||'active', c.preconditions||null, c.steps||null, c.expected_result||null, c.tags||null);
            });
            if (r) caseIdMap[c.id] = r.id;
          });
        }

        function importPlans(plans, planCases, repoId) {
          (plans || []).forEach(function(p) {
            var r = safeRun(function() {
              return db.prepare('INSERT INTO test_plans (repository_id,name,description,status) VALUES (?,?,?,?) RETURNING id')
                .get(repoId, p.name, p.description||null, p.status||'active');
            });
            if (r) planIdMap[p.id] = r.id;
          });
          (planCases || []).forEach(function(pc) {
            var newPlanId = planIdMap[pc.test_plan_id];
            var newCaseId = caseIdMap[pc.test_case_id];
            if (newPlanId && newCaseId) {
              safeRun(function() {
                db.prepare('INSERT INTO test_plan_cases (test_plan_id,test_case_id,sort_order) VALUES (?,?,?)').run(newPlanId, newCaseId, pc.sort_order||0);
              });
            }
          });
        }

        function importRuns(runs, results, notes, runNotes, repoId) {
          (runs || []).forEach(function(r) {
            var newPlanId = r.test_plan_id ? (planIdMap[r.test_plan_id] || null) : null;
            var res2 = safeRun(function() {
              return db.prepare('INSERT INTO test_runs (repository_id,test_plan_id,name,description,test_url,environment,browser,status,completed_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
                .get(repoId, newPlanId, r.name, r.description||null, r.test_url||null, r.environment||null, r.browser||null, r.status||'in_progress', r.completed_at||null);
            }) || safeRun(function() {
              return db.prepare('INSERT INTO test_runs (repository_id,test_plan_id,name,description,status,completed_at) VALUES (?,?,?,?,?,?) RETURNING id')
                .get(repoId, newPlanId, r.name, r.description||null, r.status||'in_progress', r.completed_at||null);
            });
            if (res2) runIdMap[r.id] = res2.id;
          });
          (results || []).forEach(function(r) {
            var newRunId  = runIdMap[r.test_run_id];
            var newCaseId = caseIdMap[r.test_case_id];
            if (newRunId && newCaseId) {
              var res3 = safeRun(function() {
                return db.prepare('INSERT INTO test_run_results (test_run_id,test_case_id,status) VALUES (?,?,?) RETURNING id')
                  .get(newRunId, newCaseId, r.status||'pending');
              });
              if (res3) resultIdMap[r.id] = res3.id;
            }
          });
          (notes || []).forEach(function(n) {
            var newResultId = resultIdMap[n.test_run_result_id];
            if (newResultId) safeRun(function() {
              db.prepare('INSERT INTO test_run_notes (test_run_result_id,content) VALUES (?,?)').run(newResultId, rewriteImagePaths(n.content, imageMap));
            });
          });
          (runNotes || []).forEach(function(n) {
            var newRunId = runIdMap[n.test_run_id];
            if (newRunId) safeRun(function() {
              db.prepare('INSERT INTO test_run_run_notes (test_run_id,content) VALUES (?,?)').run(newRunId, rewriteImagePaths(n.content, imageMap));
            });
          });
        }

        var redirectUrl = '/';
        try {
          if (data.type === 'project') {
            var slug = uniqueSlug(db, 'projects', toSlug(data.project.name));
            var proj = db.prepare('INSERT INTO projects (name,slug,description,color) VALUES (?,?,?,?) RETURNING id')
              .get(data.project.name, slug, data.project.description||null, data.project.color||'#4f7ef8');
            (data.repos || []).forEach(function(repo) {
              var rslug   = uniqueSlug(db, 'repositories', toSlug(repo.name), 'AND project_id = ?', [proj.id]);
              var newRepo = db.prepare('INSERT INTO repositories (project_id,name,slug,description) VALUES (?,?,?,?) RETURNING id')
                .get(proj.id, repo.name, rslug, repo.description||null);
              importGroups((data.groups||[]).filter(function(g) { return g.repository_id === repo.id; }), newRepo.id);
              importCases ((data.cases ||[]).filter(function(c) { return c.repository_id === repo.id; }), newRepo.id);
              importPlans ((data.plans ||[]).filter(function(p) { return p.repository_id === repo.id; }), data.planCases, newRepo.id);
              importRuns  ((data.runs  ||[]).filter(function(r) { return r.repository_id === repo.id; }), data.results, data.notes, data.runNotes, newRepo.id);
            });
            redirectUrl = '/projects/' + slug;

          } else if (data.type === 'repository') {
            var tp = db.prepare('SELECT * FROM projects WHERE id = ?').get(target_project_id);
            if (!tp) { db.close(); return res.status(400).json({ error: 'Select a target project to import this repository into.' }); }
            var rslug2  = uniqueSlug(db, 'repositories', toSlug(data.repo.name), 'AND project_id = ?', [tp.id]);
            var nr2     = db.prepare('INSERT INTO repositories (project_id,name,slug,description) VALUES (?,?,?,?) RETURNING id')
              .get(tp.id, data.repo.name, rslug2, data.repo.description||null);
            importGroups(data.groups, nr2.id);
            importCases(data.cases, nr2.id);
            importPlans(data.plans, data.planCases, nr2.id);
            importRuns(data.runs, data.results, data.notes, data.runNotes, nr2.id);
            redirectUrl = '/projects/' + tp.slug + '/repos/' + rslug2;

          } else if (data.type === 'testcases') {
            var tr1 = db.prepare('SELECT * FROM repositories WHERE id = ?').get(target_repo_id);
            if (!tr1) { db.close(); return res.status(400).json({ error: 'Target repository not found' }); }
            var tp1 = db.prepare('SELECT * FROM projects WHERE id = ?').get(tr1.project_id);
            importGroups(data.groups, tr1.id);
            importCases(data.cases, tr1.id);
            redirectUrl = '/projects/' + tp1.slug + '/repos/' + tr1.slug;

          } else if (data.type === 'testplan') {
            var tr2 = db.prepare('SELECT * FROM repositories WHERE id = ?').get(target_repo_id);
            if (!tr2) { db.close(); return res.status(400).json({ error: 'Target repository not found' }); }
            var tp2 = db.prepare('SELECT * FROM projects WHERE id = ?').get(tr2.project_id);
            importGroups(data.groups, tr2.id);
            importCases(data.cases, tr2.id);
            importPlans([data.plan], data.planCases, tr2.id);
            redirectUrl = '/projects/' + tp2.slug + '/repos/' + tr2.slug;

          } else if (data.type === 'testrun') {
            var tr3 = db.prepare('SELECT * FROM repositories WHERE id = ?').get(target_repo_id);
            if (!tr3) { db.close(); return res.status(400).json({ error: 'Target repository not found' }); }
            var tp3 = db.prepare('SELECT * FROM projects WHERE id = ?').get(tr3.project_id);
            importCases(data.cases, tr3.id);
            importRuns([data.run], data.results, data.notes, data.runNotes, tr3.id);
            redirectUrl = '/projects/' + tp3.slug + '/repos/' + tr3.slug;

          } else {
            db.close();
            return res.status(400).json({ error: 'Unknown type: ' + data.type });
          }

          db.close();
          res.json({ ok: true, redirect: redirectUrl });

        } catch(err2) {
          console.error('Import error:', err2);
          try { db.close(); } catch(e) {}
          res.status(500).json({ error: err2.message });
        }

      }).catch(function(err) {
        try { db.close(); } catch(e) {}
        res.status(500).json({ error: err.message });
      });
    }).catch(function(err) {
      try { db.close(); } catch(e) {}
      res.status(500).json({ error: err.message });
    });
  }).catch(function(err) {
    try { db.close(); } catch(e) {}
    res.status(500).json({ error: 'Could not open zip: ' + err.message });
  });
});

module.exports = router;