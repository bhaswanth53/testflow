const express = require('express');
const path = require('path');
const { create } = require('express-handlebars');
const { initDb } = require('./utils/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Handlebars
const hbs = create({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, '../views/layouts'),
  partialsDir: path.join(__dirname, '../views/partials'),
  helpers: {
    eq: (a, b) => a == b,
    ne: (a, b) => a != b,
    includes: (arr, val) => Array.isArray(arr) && arr.map(String).includes(String(val)),
    json: (v) => { try { return typeof v === 'string' ? JSON.parse(v) : JSON.stringify(v); } catch(e) { return JSON.stringify(v); } },
    parseJson: (v) => { try { return JSON.parse(v); } catch(e) { return []; } },
    colorList: () => ["#4f7ef8","#16a34a","#dc2626","#d97706","#7c3aed","#ea580c","#0891b2","#db2777","#374151"],
    envClass: (e) => ({ 'Local': 'local', 'Development': 'dev', 'QA': 'qa', 'Staging': 'staging', 'Production': 'prod' }[e] || 'default'),
    priorityClass: (p) => ({ critical: 'priority-critical', high: 'priority-high', medium: 'priority-medium', low: 'priority-low' }[p] || ''),
    statusClass: (s) => ({ passed: 'status-passed', failed: 'status-failed', blocked: 'status-blocked', skipped: 'status-skipped', pending: 'status-pending', in_progress: 'status-inprogress', completed: 'status-completed', aborted: 'status-aborted', active: 'status-active', archived: 'status-archived' }[s] || ''),
    capitalize: (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '',
    formatDate: (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
    formatDateTime: (d) => d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    pct: (a, b) => b > 0 ? Math.round((a / b) * 100) : 0,
    or: (a, b) => a || b,
    and: (a, b) => a && b,
    ifCond: function(v1, op, v2, options) {
      switch(op) {
        case '==': return (v1==v2) ? options.fn(this) : options.inverse(this);
        case '>': return (v1>v2) ? options.fn(this) : options.inverse(this);
        case '<': return (v1<v2) ? options.fn(this) : options.inverse(this);
        default: return options.inverse(this);
      }
    },
    add: (a, b) => Number(a) + Number(b),
    sub: (a, b) => Number(a) - Number(b),
    typeLabel: (t) => ({ functional:'Functional',regression:'Regression',smoke:'Smoke',performance:'Performance',security:'Security',usability:'Usability',other:'Other' }[t] || t),
    statusLabel: (s) => ({ in_progress:'In Progress',completed:'Completed',aborted:'Aborted',active:'Active',archived:'Archived' }[s] || s),
    truncate: (s, len) => s && s.length > len ? s.slice(0, len) + '…' : s,
  }
});

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
const projectsRouter = require('./routes/projects');
const reposRouter = require('./routes/repositories');
const casesRouter = require('./routes/testcases');
const plansRouter = require('./routes/testplans');
const runsRouter = require('./routes/testruns');
const uploadsRouter = require('./routes/uploads');

app.use('/', projectsRouter);
app.use('/projects/:projectSlug/repos', reposRouter);
app.use('/projects/:projectSlug/repos/:repoSlug/cases', casesRouter);
app.use('/projects/:projectSlug/repos/:repoSlug/plans', plansRouter);
app.use('/projects/:projectSlug/repos/:repoSlug/runs', runsRouter);
app.use('/upload', uploadsRouter);

// 404
app.use((req, res) => res.status(404).render('404', { title: 'Not Found' }));

// Error
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message });
});

// Start only after DB is ready
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 TestFlow running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
