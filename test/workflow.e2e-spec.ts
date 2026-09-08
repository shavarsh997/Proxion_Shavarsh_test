import * as request from 'supertest';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const password = 'Password123!';

type Session = { accessToken: string };
type AuthenticatedApi = {
  get(path: string): request.Test;
  patch(path: string): request.Test;
  post(path: string): request.Test;
  put(path: string): request.Test;
};

async function login(email: string): Promise<Session> {
  const response = await request(baseUrl).post('/auth/login').send({ email, password }).expect(201);
  return response.body as Session;
}

function authenticatedApi(accessToken: string): AuthenticatedApi {
  const withAuthorization = (test: request.Test) =>
    test.set('Authorization', `Bearer ${accessToken}`);
  return {
    get: (path) => withAuthorization(request(baseUrl).get(path)),
    patch: (path) => withAuthorization(request(baseUrl).patch(path)),
    post: (path) => withAuthorization(request(baseUrl).post(path)),
    put: (path) => withAuthorization(request(baseUrl).put(path)),
  };
}

describe('core workflow (e2e)', () => {
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
    await adminApi
      .post(`/tasks/${task.body.id}/assign`)
      .send({ expertId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
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
      .send({ content: 'First version' })
      .expect(201);
    await expertApi.post(`/tasks/${task.body.id}/submit`).expect(201);
    await expertApi
      .patch(`/submissions/${v1.body.id}`)
      .send({ content: 'A forbidden replacement' })
      .expect(409);
    const firstReview = await adminApi
      .post(`/submissions/${v1.body.id}/reviews`)
      .send({ reviewerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rubricVersionId })
      .expect(201);
    await reviewerApi
      .put(`/reviews/${firstReview.body.id}/scores/${criterionId}`)
      .send({ score: 3, comment: 'Needs clarification' })
      .expect(200);
    await reviewerApi
      .put(`/reviews/${firstReview.body.id}/scores/${criterionId}`)
      .send({ score: 4, comment: 'Improved reasoning' })
      .expect(200);
    await reviewerApi.post(`/tasks/${task.body.id}/request-rework`).expect(201);

    await expertApi.post(`/tasks/${task.body.id}/start`).expect(201);
    const v2 = await expertApi
      .post(`/tasks/${task.body.id}/submissions`)
      .send({ content: 'Second version' })
      .expect(201);
    await expertApi.post(`/tasks/${task.body.id}/submit`).expect(201);
    const secondReview = await adminApi
      .post(`/submissions/${v2.body.id}/reviews`)
      .send({ reviewerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rubricVersionId })
      .expect(201);
    await reviewerApi
      .put(`/reviews/${secondReview.body.id}/scores/${criterionId}`)
      .send({ score: 5, comment: 'Ready to approve' })
      .expect(200);
    await reviewerApi.post(`/tasks/${task.body.id}/approve`).expect(201);

    const completedTask = await adminApi.get(`/tasks/${task.body.id}`).expect(200);
    expect(completedTask.body.status).toBe('APPROVED');
    expect(completedTask.body.submissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: v1.body.id,
          version: 1,
          content: 'First version',
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
    expect(completedReview.body.rubricVersionId).toBe(rubricVersionId);
    expect(completedReview.body.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rubricCriterionId: criterionId, score: expect.anything() }),
      ]),
    );

    const auditLog = await adminApi.get('/audit-logs?limit=100').expect(200);
    const taskTransitions = auditLog.body.data.filter(
      (entry: { entityId: string; action: string }) =>
        entry.entityId === task.body.id && entry.action === 'STATUS_CHANGED',
    );
    expect(taskTransitions).toHaveLength(8);
    expect(auditLog.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'ReviewScore',
          action: 'UPDATED',
          before: { score: 3, comment: 'Needs clarification' },
          after: { score: 4, comment: 'Improved reasoning' },
        }),
      ]),
    );
  });
});
