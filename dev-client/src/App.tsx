import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, getLogs } from './api/client';

type Role = 'ADMIN' | 'EXPERT' | 'REVIEWER';
type User = { id: string; email: string; role: Role };
type Page<T> = { data: T[]; meta: { total: number } };
type Assignment = { id: string; taskId: string; expertId: string; assignedAt: string };
type Submission = {
  id: string;
  assignmentId: string;
  version: number;
  status: 'DRAFT' | 'SUBMITTED';
  content: string;
  createdAt: string;
  submittedAt?: string | null;
};
type Criterion = {
  id: string;
  name: string;
  description?: string | null;
  minScore: string | number;
  maxScore: string | number;
  weight: string | number;
  position: number;
};
type Task = {
  id: string;
  title: string;
  instructions: string;
  status: string;
  project: { id: string; name: string };
  assignments: Assignment[];
  submissions: Submission[];
  reviews?: Review[];
};
type Review = {
  id: string;
  reviewerId: string;
  status: 'OPEN' | 'COMPLETED';
  decision?: 'APPROVED' | 'REWORK_REQUESTED' | null;
  completedAt?: string | null;
  submission: Submission & { assignment?: Assignment & { task?: Task } };
  rubricVersion: { id: string; version: number; criteria: Criterion[] };
  scores: { rubricCriterionId: string; score: string | number; comment?: string | null }[];
};
type Project = {
  id: string;
  name: string;
  description?: string | null;
  _count?: { tasks: number; rubrics: number };
};
type Session = { token: string; user: User };

const users = {
  ADMIN: { email: 'admin@proxion.local', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  EXPERT: { email: 'expert@proxion.local', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  REVIEWER: { email: 'reviewer@proxion.local', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
} as const;
const password = 'Password123!';
const defaultRubricVersionId = '55555555-5555-4555-8555-555555555551';
const initialCriteria = JSON.stringify(
  [
    {
      name: 'Accuracy',
      description: 'Claims are supported by evidence.',
      minScore: 0,
      maxScore: 5,
      weight: 0.5,
      position: 1,
    },
    {
      name: 'Reasoning',
      description: 'Conclusion follows from the analysis.',
      minScore: 0,
      maxScore: 5,
      weight: 0.3,
      position: 2,
    },
    {
      name: 'Clarity',
      description: 'Response is concise and easy to follow.',
      minScore: 0,
      maxScore: 5,
      weight: 0.2,
      position: 3,
    },
  ],
  null,
  2,
);
const date = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');
const ownAssignment = (task: Task, userId: string) =>
  task.assignments.find((item) => item.expertId === userId);

function Status({ value }: { value: string }) {
  return <span className={`status ${value.toLowerCase()}`}>{value.replace(/_/g, ' ')}</span>;
}
function ErrorBanner({ error }: { error: ApiError | null }) {
  return error ? (
    <div className="error">
      <strong>
        {error.status} · {error.code}
      </strong>
      <span>{error.message}</span>
    </div>
  ) : null;
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const stored = localStorage.getItem('proxion-dev-session');
    return stored ? (JSON.parse(stored) as Session) : null;
  });
  const [tab, setTab] = useState<'dashboard' | 'tasks' | 'task' | 'admin' | 'reviews' | 'audit'>(
    'dashboard',
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const api = useMemo(() => new ApiClient(session?.token ?? null), [session]);

  const refresh = async () => {
    if (!session) return;
    const [taskPage, projectPage, reviewPage] = await Promise.all([
      api.get<Page<Task>>('/tasks?limit=100'),
      session.user.role === 'ADMIN'
        ? api.get<Page<Project>>('/projects?limit=100')
        : Promise.resolve(null),
      session.user.role === 'EXPERT'
        ? Promise.resolve(null)
        : api.get<Page<Review>>('/reviews?limit=100'),
    ]);
    setTasks(taskPage.data);
    setProjects(projectPage?.data ?? []);
    setReviews(reviewPage?.data ?? []);
    if (selectedTask) setSelectedTask(await api.get<Task>(`/tasks/${selectedTask.id}`));
  };
  const run = async <T,>(
    operation: () => Promise<T>,
    shouldRefresh = true,
  ): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (shouldRefresh) await refresh();
      return result;
    } catch (caught) {
      setError(caught as ApiError);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (session) void run(refresh, false); /* only refresh after login */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const login = async (role: Role) => {
    const result = await run(
      () =>
        new ApiClient(null).post<{ accessToken: string; user: User }>('/auth/login', {
          email: users[role].email,
          password,
        }),
      false,
    );
    if (!result) return;
    const next = { token: result.accessToken, user: result.user };
    localStorage.setItem('proxion-dev-session', JSON.stringify(next));
    setSession(next);
  };
  const logout = () => {
    localStorage.removeItem('proxion-dev-session');
    setSession(null);
    setSelectedTask(null);
    setTasks([]);
    setProjects([]);
    setReviews([]);
    setError(null);
  };
  const openTask = async (id: string) => {
    const task = await run(() => api.get<Task>(`/tasks/${id}`), false);
    if (task) {
      setSelectedTask(task);
      setTab('task');
    }
  };
  if (!session) return <Login onLogin={login} busy={busy} error={error} />;
  const navigation = [
    ['dashboard', 'Overview'],
    ['tasks', 'Tasks'],
    ...(session.user.role === 'ADMIN'
      ? [
          ['admin', 'Workspace'],
          ['audit', 'Audit log'],
        ]
      : []),
    ...(session.user.role === 'REVIEWER' ? [['reviews', 'My reviews']] : []),
  ] as const;
  return (
    <main className="shell">
      <aside>
        <div className="brand">
          PROXION <small>workflow workspace</small>
        </div>
        <nav>
          {navigation.map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? 'selected' : ''}
              onClick={() => setTab(value as typeof tab)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="side-note">
          Uses the real REST API.
          <br />
          NestJS still owns permissions.
        </div>
      </aside>
      <section className="page">
        <header>
          <div>
            <span className="eyebrow">LOCAL WORKFLOW CONSOLE</span>
            <h1>{tab === 'task' ? 'Task workspace' : tab}</h1>
          </div>
          <div className="user">
            <span>
              {session.user.email}
              <small>{session.user.role}</small>
            </span>
            <button className="quiet" onClick={() => void run(refresh)}>
              Refresh
            </button>
            <button className="quiet" onClick={() => setShowDeveloper(!showDeveloper)}>
              Requests
            </button>
            <button className="quiet" onClick={logout}>
              Logout
            </button>
          </div>
        </header>
        <ErrorBanner error={error} />
        {tab === 'dashboard' && (
          <Dashboard tasks={tasks} reviews={reviews} role={session.user.role} openTask={openTask} />
        )}
        {tab === 'tasks' && <TaskList tasks={tasks} openTask={openTask} />}
        {tab === 'task' && (
          <TaskWorkspace
            task={selectedTask}
            api={api}
            user={session.user}
            run={run}
            openTask={openTask}
          />
        )}
        {tab === 'admin' && (
          <AdminWorkspace
            api={api}
            projects={projects}
            tasks={tasks}
            run={run}
            openTask={openTask}
          />
        )}
        {tab === 'reviews' && (
          <ReviewerWorkspace reviews={reviews} api={api} run={run} openTask={openTask} />
        )}
        {tab === 'audit' && <AuditLog api={api} run={run} />}
        {showDeveloper && <DeveloperPanel />}
        {busy && <div className="loading">Working…</div>}
      </section>
    </main>
  );
}

function Login({
  onLogin,
  busy,
  error,
}: {
  onLogin: (role: Role) => Promise<void>;
  busy: boolean;
  error: ApiError | null;
}) {
  return (
    <main className="login">
      <div className="login-card">
        <span className="eyebrow">PROXION LOCAL DEMO</span>
        <h1>
          Review
          <br />
          workspace
        </h1>
        <p>Choose a seeded role. This client uses the actual API, not mocked data.</p>
        <ErrorBanner error={error} />
        {(Object.keys(users) as Role[]).map((role) => (
          <button
            disabled={busy}
            key={role}
            className="login-role"
            onClick={() => void onLogin(role)}
          >
            <strong>Continue as {role.toLowerCase()}</strong>
            <small>{users[role].email}</small>
          </button>
        ))}
        <small className="hint">Password: {password}</small>
      </div>
    </main>
  );
}
function Dashboard({
  tasks,
  reviews,
  role,
  openTask,
}: {
  tasks: Task[];
  reviews: Review[];
  role: Role;
  openTask: (id: string) => void;
}) {
  const active = tasks.filter((task) =>
    ['IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'REWORK'].includes(task.status),
  );
  return (
    <>
      <div className="metrics">
        <Metric label="Visible tasks" value={tasks.length} />
        <Metric
          label={role === 'REVIEWER' ? 'Assigned reviews' : 'Active work'}
          value={role === 'REVIEWER' ? reviews.length : active.length}
        />
        <Metric
          label="Awaiting review"
          value={tasks.filter((task) => task.status === 'SUBMITTED').length}
        />
      </div>
      <section className="card">
        <h2>Ready-to-test workflows</h2>
        <p>The seed includes draft, submitted, review, rework and approved examples.</p>
        <TaskTable tasks={tasks.slice(0, 8)} openTask={openTask} />
      </section>
    </>
  );
}
function TaskList({ tasks, openTask }: { tasks: Task[]; openTask: (id: string) => void }) {
  const [id, setId] = useState('');
  return (
    <section className="card">
      <div className="split">
        <div>
          <h2>Tasks</h2>
          <p>Only records authorized for the current user are returned.</p>
        </div>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void openTask(id);
          }}
        >
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="Task UUID"
            required
          />
          <button>Open task</button>
        </form>
      </div>
      <TaskTable tasks={tasks} openTask={openTask} />
    </section>
  );
}
function TaskTable({ tasks, openTask }: { tasks: Task[]; openTask: (id: string) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Task</th>
          <th>Project</th>
          <th>Status</th>
          <th>Assignments</th>
          <th>Versions</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id}>
            <td>
              <strong>{task.title}</strong>
              <small className="mono">{task.id}</small>
            </td>
            <td>{task.project.name}</td>
            <td>
              <Status value={task.status} />
            </td>
            <td>{task.assignments.length}</td>
            <td>{task.submissions.length}</td>
            <td>
              <button className="link" onClick={() => void openTask(task.id)}>
                Open
              </button>
            </td>
          </tr>
        ))}
        {!tasks.length && (
          <tr>
            <td colSpan={6} className="empty">
              No tasks are visible for this role.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
function Workflow({ current }: { current: string }) {
  const phases = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'APPROVED'];
  return (
    <div className="workflow">
      <div>
        {phases.map((phase, index) => (
          <span className={phase === current ? 'active' : ''} key={phase}>
            {phase.replace('_', ' ')}
            {index < phases.length - 1 && <b>→</b>}
          </span>
        ))}
      </div>
      <small className={current === 'REWORK' ? 'active' : ''}>
        IN REVIEW → REWORK → IN PROGRESS
      </small>
    </div>
  );
}

function TaskWorkspace({
  task,
  api,
  user,
  run,
  openTask,
}: {
  task: Task | null;
  api: ApiClient;
  user: User;
  run: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
  openTask: (id: string) => void;
}) {
  const [content, setContent] = useState('');
  const [reviewerId, setReviewerId] = useState<string>(users.REVIEWER.id);
  const [rubricVersionId, setRubricVersionId] = useState(defaultRubricVersionId);
  const [submissionId, setSubmissionId] = useState('');
  if (!task) return <TaskList tasks={[]} openTask={openTask} />;
  const assignment = ownAssignment(task, user.id);
  const latest = [...task.submissions].sort((left, right) => right.version - left.version)[0];
  const selectedSubmission = submissionId || latest?.id;
  const createSubmission = () =>
    assignment &&
    void run(() =>
      api.post<Submission>(`/tasks/${task.id}/submissions`, {
        assignmentId: assignment.id,
        content,
      }),
    ).then((created) => {
      if (created) setContent('');
    });
  return (
    <div className="stack">
      <section className="card task-head">
        <div>
          <span className="eyebrow">{task.project.name}</span>
          <h2>{task.title}</h2>
          <p>{task.instructions}</p>
          <small className="mono">{task.id}</small>
        </div>
        <Status value={task.status} />
      </section>
      <section className="card">
        <h3>Workflow</h3>
        <Workflow current={task.status} />
        <div className="actions">
          {user.role === 'EXPERT' && (
            <>
              <button
                disabled={!assignment || !['ASSIGNED', 'REWORK'].includes(task.status)}
                onClick={() => void run(() => api.post(`/tasks/${task.id}/start`))}
              >
                Start work
              </button>
              <button
                disabled={task.status !== 'IN_PROGRESS' || !latest}
                onClick={() => void run(() => api.post(`/tasks/${task.id}/submit`))}
              >
                Submit latest draft
              </button>
            </>
          )}
        </div>
      </section>
      {user.role === 'EXPERT' && (
        <section className="card">
          <h3>Create submission version</h3>
          <p>Versioning is scoped to your assignment; submitted work is immutable.</p>
          {assignment ? (
            <>
              <small className="mono">Assignment: {assignment.id}</small>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={6}
                placeholder="Write the expert response…"
              />
              <button
                disabled={!content.trim() || task.status !== 'IN_PROGRESS'}
                onClick={createSubmission}
              >
                Save new draft version
              </button>
            </>
          ) : (
            <p className="empty">No assignment found for this account.</p>
          )}
        </section>
      )}
      {user.role === 'ADMIN' && (
        <section className="card">
          <h3>Create review</h3>
          <p>Select a submitted submission and rubric version.</p>
          <div className="form-grid">
            <select
              value={selectedSubmission ?? ''}
              onChange={(event) => setSubmissionId(event.target.value)}
            >
              {task.submissions.map((submission) => (
                <option key={submission.id} value={submission.id}>
                  v{submission.version} · {submission.status}
                </option>
              ))}
            </select>
            <input
              value={reviewerId}
              onChange={(event) => setReviewerId(event.target.value)}
              placeholder="Reviewer UUID"
            />
            <input
              value={rubricVersionId}
              onChange={(event) => setRubricVersionId(event.target.value)}
              placeholder="Rubric version UUID"
            />
            <button
              disabled={!selectedSubmission || !rubricVersionId}
              onClick={() =>
                void run(() =>
                  api.post(`/submissions/${selectedSubmission}/reviews`, {
                    reviewerId,
                    rubricVersionId,
                  }),
                )
              }
            >
              Create review
            </button>
          </div>
        </section>
      )}
      <section className="card">
        <h3>Assignments</h3>
        <div className="versions">
          {task.assignments.map((item) => (
            <article key={item.id}>
              <strong>{item.expertId === user.id ? 'Your assignment' : 'Expert assignment'}</strong>
              <small className="mono">
                {item.id} · expert {item.expertId}
              </small>
            </article>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>Submission history</h3>
        <div className="versions">
          {[...task.submissions]
            .sort((left, right) => right.version - left.version)
            .map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                canEdit={
                  user.role === 'EXPERT' &&
                  assignment?.id === submission.assignmentId &&
                  submission.status === 'DRAFT'
                }
                api={api}
                run={run}
              />
            ))}
          {!task.submissions.length && <p className="empty">No submissions have been created.</p>}
        </div>
      </section>
      {user.role !== 'EXPERT' && (
        <section className="card">
          <h3>Visible reviews</h3>
          {task.reviews?.length ? (
            task.reviews.map((review) => <ReviewSummary review={review} key={review.id} />)
          ) : (
            <p className="empty">No reviews are visible on this task.</p>
          )}
        </section>
      )}
    </div>
  );
}
function SubmissionCard({
  submission,
  canEdit,
  api,
  run,
}: {
  submission: Submission;
  canEdit: boolean;
  api: ApiClient;
  run: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [draft, setDraft] = useState(submission.content);
  return (
    <article>
      <div>
        <strong>
          Version {submission.version} <Status value={submission.status} />
        </strong>
        <small>
          Created {date(submission.createdAt)} · Submitted {date(submission.submittedAt)}
        </small>
      </div>
      {canEdit ? (
        <>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
          <button
            disabled={!draft.trim() || draft === submission.content}
            onClick={() =>
              void run(() => api.patch(`/submissions/${submission.id}`, { content: draft }))
            }
          >
            Update draft
          </button>
        </>
      ) : (
        <pre>{submission.content}</pre>
      )}
    </article>
  );
}

function AdminWorkspace({
  api,
  projects,
  tasks,
  run,
  openTask,
}: {
  api: ApiClient;
  projects: Project[];
  tasks: Task[];
  run: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
  openTask: (id: string) => void;
}) {
  const [criteria, setCriteria] = useState(initialCriteria);
  const [projectId, setProjectId] = useState('');
  const submit = (
    event: FormEvent<HTMLFormElement>,
    operation: (data: FormData) => Promise<unknown>,
  ) => {
    event.preventDefault();
    void run(() => operation(new FormData(event.currentTarget)));
  };
  return (
    <div className="stack">
      <section className="card">
        <h2>Projects</h2>
        <form
          className="inline-form"
          onSubmit={(event) =>
            submit(event, (form) =>
              api.post('/projects', {
                name: form.get('name'),
                description: form.get('description') || undefined,
              }),
            )
          }
        >
          <input name="name" placeholder="Project name" required />
          <input name="description" placeholder="Short description" />
          <button>Create project</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Tasks</th>
              <th>Rubrics</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td>
                  <strong>{project.name}</strong>
                  <small className="mono">{project.id}</small>
                </td>
                <td>{project._count?.tasks ?? 0}</td>
                <td>{project._count?.rubrics ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Create task and assignment</h2>
        <form
          className="form-grid"
          onSubmit={(event) =>
            submit(event, async (form) => {
              const task = await api.post<Task>(`/projects/${form.get('projectId')}/tasks`, {
                title: form.get('title'),
                instructions: form.get('instructions'),
              });
              await api.post(`/tasks/${task.id}/assign`, { expertId: form.get('expertId') });
              return task;
            })
          }
        >
          <input
            name="projectId"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="Project UUID"
            required
          />
          <input name="title" placeholder="Task title" required />
          <textarea name="instructions" placeholder="Instructions for the expert" required />
          <input
            name="expertId"
            defaultValue={users.EXPERT.id}
            placeholder="Expert UUID"
            required
          />
          <button>Create and assign</button>
        </form>
      </section>
      <section className="card">
        <h2>Rubric editor</h2>
        <p>JSON is exposed here for fast local test-data iteration.</p>
        <textarea
          rows={10}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        <form
          className="inline-form"
          onSubmit={(event) =>
            submit(event, (form) =>
              api.post(`/projects/${form.get('projectId')}/rubrics`, {
                name: form.get('name'),
                criteria: JSON.parse(criteria),
              }),
            )
          }
        >
          <input name="projectId" placeholder="Project UUID" required />
          <input name="name" placeholder="Rubric name" required />
          <button>Create rubric v1</button>
        </form>
        <form
          className="inline-form top-gap"
          onSubmit={(event) =>
            submit(event, (form) =>
              api.post(`/rubrics/${form.get('rubricId')}/versions`, {
                criteria: JSON.parse(criteria),
              }),
            )
          }
        >
          <input name="rubricId" placeholder="Rubric UUID" required />
          <button>Create next version</button>
        </form>
      </section>
      <section className="card">
        <h2>Task inventory</h2>
        <TaskTable tasks={tasks} openTask={openTask} />
      </section>
    </div>
  );
}

function ReviewerWorkspace({
  reviews,
  api,
  run,
  openTask,
}: {
  reviews: Review[];
  api: ApiClient;
  run: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
  openTask: (id: string) => void;
}) {
  const [edits, setEdits] = useState<Record<string, { score: string; comment: string }>>({});
  return (
    <div className="stack">
      {reviews.map((review) => {
        const task = review.submission.assignment?.task;
        return (
          <section className="card" key={review.id}>
            <div className="split">
              <div>
                <span className="eyebrow">{task?.project.name ?? 'Assigned review'}</span>
                <h2>{task?.title ?? `Submission v${review.submission.version}`}</h2>
                <p>
                  <Status value={review.status} />{' '}
                  {review.decision && <Status value={review.decision} />} · rubric v
                  {review.rubricVersion.version}
                </p>
              </div>
              {task && (
                <button className="quiet" onClick={() => void openTask(task.id)}>
                  Open task
                </button>
              )}
            </div>
            <pre>{review.submission.content}</pre>
            <div className="score-grid">
              {review.rubricVersion.criteria.map((criterion) => {
                const saved = review.scores.find(
                  (score) => score.rubricCriterionId === criterion.id,
                );
                const value = edits[criterion.id] ?? {
                  score: String(saved?.score ?? ''),
                  comment: saved?.comment ?? '',
                };
                return (
                  <div className="score-row" key={criterion.id}>
                    <strong>
                      {criterion.position}. {criterion.name}
                    </strong>
                    <small>
                      {criterion.description} · {criterion.minScore}–{criterion.maxScore}
                    </small>
                    <input
                      disabled={review.status === 'COMPLETED'}
                      type="number"
                      min={Number(criterion.minScore)}
                      max={Number(criterion.maxScore)}
                      value={value.score}
                      onChange={(event) =>
                        setEdits({
                          ...edits,
                          [criterion.id]: { ...value, score: event.target.value },
                        })
                      }
                    />
                    <input
                      disabled={review.status === 'COMPLETED'}
                      value={value.comment}
                      onChange={(event) =>
                        setEdits({
                          ...edits,
                          [criterion.id]: { ...value, comment: event.target.value },
                        })
                      }
                      placeholder="Comment"
                    />
                    <button
                      disabled={review.status === 'COMPLETED' || !value.score}
                      onClick={() =>
                        void run(() =>
                          api.put(`/reviews/${review.id}/scores/${criterion.id}`, {
                            score: Number(value.score),
                            comment: value.comment,
                          }),
                        )
                      }
                    >
                      Save
                    </button>
                  </div>
                );
              })}
            </div>
            {review.status === 'OPEN' && (
              <div className="actions">
                <button
                  onClick={() => void run(() => api.post(`/reviews/${review.id}/request-rework`))}
                >
                  Request rework
                </button>
                <button onClick={() => void run(() => api.post(`/reviews/${review.id}/approve`))}>
                  Approve review
                </button>
              </div>
            )}
          </section>
        );
      })}
      {!reviews.length && (
        <section className="card empty">
          No reviews are currently assigned to this reviewer.
        </section>
      )}
    </div>
  );
}
function ReviewSummary({ review }: { review: Review }) {
  return (
    <article className="review-summary">
      <div className="split">
        <strong>Review {review.id}</strong>
        <span>
          <Status value={review.status} /> {review.decision && <Status value={review.decision} />}
        </span>
      </div>
      <p>
        Submission v{review.submission.version} · rubric v{review.rubricVersion.version}
      </p>
      <ul>
        {review.rubricVersion.criteria.map((criterion) => {
          const score = review.scores.find((item) => item.rubricCriterionId === criterion.id);
          return (
            <li key={criterion.id}>
              {criterion.name}:{' '}
              {score ? `${score.score}${score.comment ? ` — ${score.comment}` : ''}` : 'not scored'}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
function AuditLog({
  api,
  run,
}: {
  api: ApiClient;
  run: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    void run(async () => {
      const result = await api.get<Page<Record<string, unknown>>>('/audit-logs?limit=100');
      setItems(result.data);
      return result;
    });
  }, []);
  const visible = items.filter((item) =>
    JSON.stringify(item).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="card">
      <div className="split">
        <div>
          <h2>Audit log</h2>
          <p>Append-only events emitted by workflow services.</p>
        </div>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter events"
        />
      </div>
      <div className="audit-table">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={String(item.id)}>
                <td>{date(item.createdAt as string)}</td>
                <td>
                  <Status value={String(item.action)} />
                </td>
                <td>
                  {String(item.entityType)}
                  <small className="mono">{String(item.entityId)}</small>
                </td>
                <td>
                  <code>{JSON.stringify(item.before)}</code>
                </td>
                <td>
                  <code>{JSON.stringify(item.after)}</code>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="empty">
                  No matching audit events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function DeveloperPanel() {
  const logs = getLogs();
  return (
    <section className="developer">
      <h3>Recent API requests</h3>
      {logs.map((log, index) => (
        <details key={`${log.at}-${index}`}>
          <summary>
            <b>{log.status}</b> {log.method} {log.url} <small>{date(log.at)}</small>
          </summary>
          <pre>{JSON.stringify({ request: log.body, response: log.response }, null, 2)}</pre>
        </details>
      ))}
      {!logs.length && <p>No requests recorded yet.</p>}
    </section>
  );
}
