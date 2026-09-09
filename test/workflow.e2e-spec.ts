import * as request from 'supertest';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const password = 'Password123!';
const expertAId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const expertBId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reviewerAId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const reviewerBId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const apiPath = (path: string) => `/api${path}`;

type Session = { accessToken: string };
type AuthenticatedApi = {
  get(path: string): request.Test;
  patch(path: string): request.Test;
  post(path: string): request.Test;
  put(path: string): request.Test;
};

const sessions = new Map<string, Promise<Session>>();

function login(email: string): Promise<Session> {
  const existing = sessions.get(email);
  if (existing) return existing;

  const session = request(baseUrl)
    .post(apiPath('/auth/login'))
    .send({ email, password })
    .expect(201)
    .then((response) => response.body as Session);
  sessions.set(email, session);
  return session;
}

function authenticatedApi(accessToken: string): AuthenticatedApi {
  const withAuthorization = (test: request.Test) =>
    test.set('Authorization', `Bearer ${accessToken}`);
  return {
    get: (path) => withAuthorization(request(baseUrl).get(apiPath(path))),
    patch: (path) => withAuthorization(request(baseUrl).patch(apiPath(path))),
    post: (path) => withAuthorization(request(baseUrl).post(apiPath(path))),
    put: (path) => withAuthorization(request(baseUrl).put(apiPath(path))),
  };
}

describe('core workflow (e2e)', () => {
  it('returns a validation code and prevents non-admin project access', async () => {
    const invalidLogin = await request(baseUrl)
      .post(apiPath('/auth/login'))
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(invalidLogin.body.code).toBe('VALIDATION_ERROR');

    const expert = await login('expert@proxion.local');
    await authenticatedApi(expert.accessToken).get('/projects').expect(403);
  });

  it('preserves submitted versions through rework and approval with an audit trail', async () => {
    const [admin, expert, reviewer] = await Promise.all([
      login('admin@proxion.local'),
      login('expert@proxion.local'),
      login('reviewer@proxion.local'),
    ]);
    const suffix = Date.now().toString();
    const adminApi = authenticatedApi(admin.accessToken);
    const expertApi = authenticatedApi(expert.accessToken);
    const reviewerApi = authenticatedApi(reviewer.accessToken);

    const project = await adminApi
      .post('/projects')
      .send({ name: `Workflow e2e ${suffix}` })
      .expect(201);
    const task = await adminApi
      .post(`/projects/${project.body.id}/tasks`)
      .send({ title: 'Review this response', instructions: 'Use the rubric.' })
      .expect(201);
    const assignment = await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: expertAId })
      .expect(201);
    const rubric = await adminApi
      .post(`/projects/${project.body.id}/rubrics`)
      .send({
        name: 'Quality',
        criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
      })
      .expect(201);
    const rubricVersionId = rubric.body.versions[0].id as string;
    const criterionId = rubric.body.versions[0].criteria[0].id as string;

    await expertApi.post(`/tasks/${task.body.id}/start`).expect(201);
    const v1 = await expertApi
      .post(`/tasks/${task.body.id}/submissions`)
      .send({ assignmentId: assignment.body.id, content: 'First version' })
      .expect(201);
    await expertApi
      .patch(`/submissions/${v1.body.id}`)
      .send({ content: 'First version, revised before submission' })
      .expect(200);
    await expertApi.post(`/tasks/${task.body.id}/submit`).expect(201);
    await expertApi
      .patch(`/submissions/${v1.body.id}`)
      .send({ content: 'A forbidden replacement' })
      .expect(409);
    const firstReview = await adminApi
      .post(`/submissions/${v1.body.id}/reviews`)
      .send({ reviewerId: reviewerAId, rubricVersionId })
      .expect(201);
    await reviewerApi
      .put(`/reviews/${firstReview.body.id}/scores/${criterionId}`)
      .send({ score: 3, comment: 'Needs clarification' })
      .expect(200);
    await reviewerApi
      .put(`/reviews/${firstReview.body.id}/scores/${criterionId}`)
      .send({ score: 4, comment: 'Improved reasoning' })
      .expect(200);
    await reviewerApi.post(`/reviews/${firstReview.body.id}/request-rework`).expect(201);

    await expertApi.post(`/tasks/${task.body.id}/start`).expect(201);
    const v2 = await expertApi
      .post(`/tasks/${task.body.id}/submissions`)
      .send({ assignmentId: assignment.body.id, content: 'Second version' })
      .expect(201);
    await expertApi.post(`/tasks/${task.body.id}/submit`).expect(201);
    const secondReview = await adminApi
      .post(`/submissions/${v2.body.id}/reviews`)
      .send({ reviewerId: reviewerAId, rubricVersionId })
      .expect(201);
    await reviewerApi
      .put(`/reviews/${secondReview.body.id}/scores/${criterionId}`)
      .send({ score: 5, comment: 'Ready to approve' })
      .expect(200);
    await reviewerApi.post(`/reviews/${secondReview.body.id}/approve`).expect(201);

    const completedTask = await adminApi.get(`/tasks/${task.body.id}`).expect(200);
    expect(completedTask.body.status).toBe('APPROVED');
    expect(completedTask.body.submissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: v1.body.id,
          version: 1,
          content: 'First version, revised before submission',
          status: 'SUBMITTED',
        }),
        expect.objectContaining({
          id: v2.body.id,
          version: 2,
          content: 'Second version',
          status: 'SUBMITTED',
        }),
      ]),
    );

    const completedReview = await adminApi.get(`/reviews/${secondReview.body.id}`).expect(200);
    expect(completedReview.body).toMatchObject({
      status: 'COMPLETED',
      decision: 'APPROVED',
      completedAt: expect.any(String),
    });
    expect(completedReview.body.rubricVersionId).toBe(rubricVersionId);
    expect(completedReview.body.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rubricCriterionId: criterionId, score: expect.anything() }),
      ]),
    );

    const auditLog = await adminApi.get('/audit-logs?limit=100').expect(200);
    const taskTransitions = auditLog.body.data.filter(
      (entry: { entityId: string; action: string }) =>
        entry.entityId === task.body.id && entry.action === 'TASK_STATUS_CHANGED',
    );
    expect(taskTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: expect.objectContaining({ status: 'ASSIGNED' }),
          after: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
        expect.objectContaining({
          before: expect.objectContaining({ status: 'IN_PROGRESS' }),
          after: expect.objectContaining({ status: 'SUBMITTED' }),
        }),
        expect.objectContaining({
          before: expect.objectContaining({ status: 'SUBMITTED' }),
          after: expect.objectContaining({ status: 'IN_REVIEW' }),
        }),
        expect.objectContaining({
          before: expect.objectContaining({ status: 'IN_REVIEW' }),
          after: expect.objectContaining({ status: 'REWORK' }),
        }),
        expect.objectContaining({
          before: expect.objectContaining({ status: 'REWORK' }),
          after: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
        expect.objectContaining({
          before: expect.objectContaining({ status: 'IN_REVIEW' }),
          after: expect.objectContaining({ status: 'APPROVED' }),
        }),
      ]),
    );
    expect(auditLog.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'ReviewScore',
          action: 'REVIEW_SCORE_UPDATED',
          before: { score: 3, comment: 'Needs clarification' },
          after: { score: 4, comment: 'Improved reasoning' },
        }),
      ]),
    );
  });

  it('serializes parallel submission, rubric-version, review, and decision mutations', async () => {
    const [admin, expert, reviewer] = await Promise.all([
      login('admin@proxion.local'),
      login('expert@proxion.local'),
      login('reviewer@proxion.local'),
    ]);
    const suffix = `concurrency-${Date.now()}`;
    const adminApi = authenticatedApi(admin.accessToken);
    const expertApi = authenticatedApi(expert.accessToken);
    const reviewerApi = authenticatedApi(reviewer.accessToken);
    const project = await adminApi.post('/projects').send({ name: suffix }).expect(201);
    const task = await adminApi
      .post(`/projects/${project.body.id}/tasks`)
      .send({ title: 'Concurrent workflow', instructions: 'Use the rubric.' })
      .expect(201);
    const assignment = await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: expertAId })
      .expect(201);
    const rubric = await adminApi
      .post(`/projects/${project.body.id}/rubrics`)
      .send({
        name: 'Concurrent quality',
        criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
      })
      .expect(201);
    const rubricVersionId = rubric.body.versions[0].id as string;
    const criterionId = rubric.body.versions[0].criteria[0].id as string;

    const parallelVersions = await Promise.all([
      adminApi.post(`/rubrics/${rubric.body.id}/versions`).send({
        criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
      }),
      adminApi.post(`/rubrics/${rubric.body.id}/versions`).send({
        criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
      }),
    ]);
    expect(parallelVersions.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(parallelVersions.map((response) => response.body.version)).size).toBe(2);

    await expertApi.post(`/tasks/${task.body.id}/start`).expect(201);
    const parallelDrafts = await Promise.all([
      expertApi
        .post(`/tasks/${task.body.id}/submissions`)
        .send({ assignmentId: assignment.body.id, content: 'draft A' }),
      expertApi
        .post(`/tasks/${task.body.id}/submissions`)
        .send({ assignmentId: assignment.body.id, content: 'draft B' }),
    ]);
    expect(parallelDrafts.map((response) => response.status).sort()).toEqual([201, 409]);
    const draft = parallelDrafts.find((response) => response.status === 201)!;
    const draftsBeforeSubmit = await expertApi
      .get(`/tasks/${task.body.id}/submissions`)
      .expect(200);
    expect(
      draftsBeforeSubmit.body.filter(
        (submission: { status: string; assignmentId: string }) =>
          submission.status === 'DRAFT' && submission.assignmentId === assignment.body.id,
      ),
    ).toHaveLength(1);

    const createDuringSubmit = await Promise.all([
      expertApi
        .post(`/tasks/${task.body.id}/submissions`)
        .send({ assignmentId: assignment.body.id, content: 'late concurrent draft' }),
      expertApi.post(`/tasks/${task.body.id}/submit`),
      expertApi.post(`/tasks/${task.body.id}/submit`),
    ]);
    expect(createDuringSubmit.map((response) => response.status).sort()).toEqual([201, 409, 409]);
    const afterConcurrentSubmit = await expertApi.get(`/tasks/${task.body.id}`).expect(200);
    expect(afterConcurrentSubmit.body.status).toBe('SUBMITTED');
    expect(
      afterConcurrentSubmit.body.submissions.filter(
        (submission: { status: string; assignmentId: string }) =>
          submission.status === 'DRAFT' && submission.assignmentId === assignment.body.id,
      ),
    ).toHaveLength(0);

    const parallelReviews = await Promise.all([
      adminApi
        .post(`/submissions/${draft.body.id}/reviews`)
        .send({ reviewerId: reviewerAId, rubricVersionId }),
      adminApi
        .post(`/submissions/${draft.body.id}/reviews`)
        .send({ reviewerId: reviewerAId, rubricVersionId }),
    ]);
    expect(parallelReviews.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(parallelReviews.map((response) => response.body.id)).size).toBe(1);
    const review = parallelReviews.find((response) => response.status === 201)!;
    await reviewerApi
      .put(`/reviews/${review.body.id}/scores/${criterionId}`)
      .send({ score: 5 })
      .expect(200);

    const decisions = await Promise.all([
      reviewerApi.post(`/reviews/${review.body.id}/approve`),
      reviewerApi.post(`/reviews/${review.body.id}/request-rework`),
    ]);
    expect(decisions.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('requires a real assignment before work starts and does not leak submissions across experts', async () => {
    const [admin, expertA, expertB] = await Promise.all([
      login('admin@proxion.local'),
      login('expert@proxion.local'),
      login('expert-b@proxion.local'),
    ]);
    const suffix = `submission-access-${Date.now()}`;
    const adminApi = authenticatedApi(admin.accessToken);
    const expertAApi = authenticatedApi(expertA.accessToken);
    const expertBApi = authenticatedApi(expertB.accessToken);
    const project = await adminApi.post('/projects').send({ name: suffix }).expect(201);
    const task = await adminApi
      .post(`/projects/${project.body.id}/tasks`)
      .send({ title: 'Shared expert task', instructions: 'Keep work private.' })
      .expect(201);

    expect(task.body.status).toBe('UNASSIGNED');
    const unassignedStart = await expertAApi.post(`/tasks/${task.body.id}/start`).expect(403);
    expect(unassignedStart.body).toMatchObject({
      code: 'FORBIDDEN',
      requestId: expect.any(String),
    });
    await expertAApi
      .post(`/tasks/${task.body.id}/submissions`)
      .send({
        assignmentId: '99999999-9999-4999-8999-999999999999',
        content: 'Unassigned work must be rejected',
      })
      .expect(404);

    const assignmentA = await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: expertAId })
      .expect(201);
    const repeatedAssignment = await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: expertAId })
      .expect(201);
    expect(repeatedAssignment.body.id).toBe(assignmentA.body.id);
    const secondExpertAssignment = await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: expertBId })
      .expect(409);
    expect(secondExpertAssignment.body.code).toBe('TASK_ALREADY_ASSIGNED');
    await expertBApi.post(`/tasks/${task.body.id}/start`).expect(403);
    await expertAApi.post(`/tasks/${task.body.id}/start`).expect(201);

    const submissionA = await expertAApi
      .post(`/tasks/${task.body.id}/submissions`)
      .send({ assignmentId: assignmentA.body.id, content: 'Expert A private draft' })
      .expect(201);

    await expertBApi.get(`/submissions/${submissionA.body.id}`).expect(403);
    const visibleSubmissions = await expertAApi
      .get(`/tasks/${task.body.id}/submissions`)
      .expect(200);
    expect(visibleSubmissions.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: submissionA.body.id })]),
    );

    const taskDetail = await expertAApi.get(`/tasks/${task.body.id}`).expect(200);
    expect(taskDetail.body.submissions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: submissionA.body.id })]),
    );
  });

  it('limits a reviewer to submissions directly connected to that reviewer review', async () => {
    const [admin, expertA, expertB, reviewerA] = await Promise.all([
      login('admin@proxion.local'),
      login('expert@proxion.local'),
      login('expert-b@proxion.local'),
      login('reviewer@proxion.local'),
    ]);
    const suffix = `reviewer-submission-access-${Date.now()}`;
    const adminApi = authenticatedApi(admin.accessToken);
    const expertAApi = authenticatedApi(expertA.accessToken);
    const expertBApi = authenticatedApi(expertB.accessToken);
    const reviewerAApi = authenticatedApi(reviewerA.accessToken);
    const project = await adminApi.post('/projects').send({ name: suffix }).expect(201);
    const taskA = await adminApi
      .post(`/projects/${project.body.id}/tasks`)
      .send({
        title: 'Reviewer submission isolation',
        instructions: 'Review only your assignment.',
      })
      .expect(201);
    const taskB = await adminApi
      .post(`/projects/${project.body.id}/tasks`)
      .send({
        title: 'Unassigned reviewer submission',
        instructions: 'This submission is not visible to reviewer A.',
      })
      .expect(201);
    const assignmentA = await adminApi
      .post(`/tasks/${taskA.body.id}/assign`)
      .send({ expertId: expertAId })
      .expect(201);
    const assignmentB = await adminApi
      .post(`/tasks/${taskB.body.id}/assign`)
      .send({ expertId: expertBId })
      .expect(201);
    const rubric = await adminApi
      .post(`/projects/${project.body.id}/rubrics`)
      .send({
        name: 'Reviewer isolation rubric',
        criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
      })
      .expect(201);
    const rubricVersionId = rubric.body.versions[0].id as string;

    await expertAApi.post(`/tasks/${taskA.body.id}/start`).expect(201);
    const submissionA = await expertAApi
      .post(`/tasks/${taskA.body.id}/submissions`)
      .send({ assignmentId: assignmentA.body.id, content: 'Submission assigned to reviewer A' })
      .expect(201);
    await expertAApi.post(`/tasks/${taskA.body.id}/submit`).expect(201);
    const reviewA = await adminApi
      .post(`/submissions/${submissionA.body.id}/reviews`)
      .send({ reviewerId: reviewerAId, rubricVersionId })
      .expect(201);
    await reviewerAApi.post(`/reviews/${reviewA.body.id}/request-rework`).expect(201);
    await expertBApi.post(`/tasks/${taskB.body.id}/start`).expect(201);
    const submissionB = await expertBApi
      .post(`/tasks/${taskB.body.id}/submissions`)
      .send({ assignmentId: assignmentB.body.id, content: 'Submission not assigned to reviewer A' })
      .expect(201);

    await reviewerAApi.get(`/submissions/${submissionA.body.id}`).expect(200);
    await reviewerAApi.get(`/submissions/${submissionB.body.id}`).expect(403);
    const visibleSubmissions = await reviewerAApi
      .get(`/tasks/${taskA.body.id}/submissions`)
      .expect(200);
    expect(visibleSubmissions.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: submissionA.body.id })]),
    );
    expect(visibleSubmissions.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: submissionB.body.id })]),
    );
  });

  it('rejects every review operation from a reviewer who does not own the review', async () => {
    const [admin, expertA, reviewerA] = await Promise.all([
      login('admin@proxion.local'),
      login('expert@proxion.local'),
      login('reviewer@proxion.local'),
    ]);
    const suffix = `review-access-${Date.now()}`;
    const adminApi = authenticatedApi(admin.accessToken);
    const expertAApi = authenticatedApi(expertA.accessToken);
    const reviewerAApi = authenticatedApi(reviewerA.accessToken);
    const project = await adminApi.post('/projects').send({ name: suffix }).expect(201);
    const task = await adminApi
      .post(`/projects/${project.body.id}/tasks`)
      .send({ title: 'Reviewer ownership', instructions: 'Review ownership is strict.' })
      .expect(201);
    const assignment = await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: expertAId })
      .expect(201);
    const rubric = await adminApi
      .post(`/projects/${project.body.id}/rubrics`)
      .send({
        name: 'Reviewer ownership rubric',
        criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
      })
      .expect(201);
    const rubricVersionId = rubric.body.versions[0].id as string;
    const criterionId = rubric.body.versions[0].criteria[0].id as string;

    await expertAApi.post(`/tasks/${task.body.id}/start`).expect(201);
    const submission = await expertAApi
      .post(`/tasks/${task.body.id}/submissions`)
      .send({ assignmentId: assignment.body.id, content: 'Reviewer B owns this review' })
      .expect(201);
    await expertAApi.post(`/tasks/${task.body.id}/submit`).expect(201);
    const reviewB = await adminApi
      .post(`/submissions/${submission.body.id}/reviews`)
      .send({ reviewerId: reviewerBId, rubricVersionId })
      .expect(201);

    await reviewerAApi.get(`/reviews/${reviewB.body.id}`).expect(403);
    await reviewerAApi
      .put(`/reviews/${reviewB.body.id}/scores/${criterionId}`)
      .send({ score: 5 })
      .expect(403);
    await reviewerAApi.post(`/reviews/${reviewB.body.id}/approve`).expect(403);
    await reviewerAApi.post(`/reviews/${reviewB.body.id}/request-rework`).expect(403);
  });
});
