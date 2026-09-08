import {
  AuditAction,
  PrismaClient,
  ReviewDecision,
  ReviewStatus,
  Role,
  SubmissionStatus,
  TaskStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const password = 'Password123!';

const ids = {
  projectWorkspace: '11111111-1111-4111-8111-111111111111',
  projectArchive: '11111111-1111-4111-8111-111111111112',
  taskReady: '22222222-2222-4222-8222-222222222221',
  taskDraft: '22222222-2222-4222-8222-222222222222',
  taskSubmitted: '22222222-2222-4222-8222-222222222223',
  taskReview: '22222222-2222-4222-8222-222222222224',
  taskRework: '22222222-2222-4222-8222-222222222225',
  taskApproved: '22222222-2222-4222-8222-222222222226',
  assignmentReady: '33333333-3333-4333-8333-333333333321',
  assignmentDraft: '33333333-3333-4333-8333-333333333322',
  assignmentSubmitted: '33333333-3333-4333-8333-333333333323',
  assignmentReview: '33333333-3333-4333-8333-333333333324',
  assignmentRework: '33333333-3333-4333-8333-333333333325',
  assignmentApproved: '33333333-3333-4333-8333-333333333326',
  rubricQuality: '44444444-4444-4444-8444-444444444441',
  rubricDelivery: '44444444-4444-4444-8444-444444444442',
  qualityV1: '55555555-5555-4555-8555-555555555551',
  qualityV2: '55555555-5555-4555-8555-555555555552',
  deliveryV1: '55555555-5555-4555-8555-555555555553',
  draftSubmission: '77777777-7777-4777-8777-777777777771',
  submittedSubmission: '77777777-7777-4777-8777-777777777772',
  reviewSubmission: '77777777-7777-4777-8777-777777777773',
  reworkSubmission: '77777777-7777-4777-8777-777777777774',
  approvedSubmission: '77777777-7777-4777-8777-777777777775',
  openReview: '88888888-8888-4888-8888-888888888881',
  reworkReview: '88888888-8888-4888-8888-888888888882',
  approvedReview: '88888888-8888-4888-8888-888888888883',
};

const criteria = {
  accuracy: '66666666-6666-4666-8666-666666666661',
  reasoning: '66666666-6666-4666-8666-666666666662',
  clarity: '66666666-6666-4666-8666-666666666663',
  depth: '66666666-6666-4666-8666-666666666664',
  v2Accuracy: '66666666-6666-4666-8666-666666666665',
  v2Evidence: '66666666-6666-4666-8666-666666666666',
  delivery: '66666666-6666-4666-8666-666666666667',
};

async function upsertCriterion(input: {
  id: string;
  rubricVersionId: string;
  name: string;
  description: string;
  minScore: number;
  maxScore: number;
  weight: number;
  position: number;
}) {
  return prisma.rubricCriterion.upsert({ where: { id: input.id }, update: input, create: input });
}

async function seedAudit(
  action: AuditAction,
  entityType: string,
  entityId: string,
  actorId: string,
  after: Record<string, unknown>,
) {
  const requestId = `seed:${action}:${entityId}`;
  if (await prisma.auditLog.findFirst({ where: { requestId } })) return;
  await prisma.auditLog.create({
    data: {
      actorId,
      entityType,
      entityId,
      action,
      after: after as Prisma.InputJsonValue,
      requestId,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@proxion.local' },
    update: { passwordHash, isActive: true },
    create: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'admin@proxion.local',
      passwordHash,
      role: Role.ADMIN,
    },
  });
  const expert = await prisma.user.upsert({
    where: { email: 'expert@proxion.local' },
    update: { passwordHash, isActive: true },
    create: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'expert@proxion.local',
      passwordHash,
      role: Role.EXPERT,
    },
  });
  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@proxion.local' },
    update: { passwordHash, isActive: true },
    create: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      email: 'reviewer@proxion.local',
      passwordHash,
      role: Role.REVIEWER,
    },
  });
  const expertB = await prisma.user.upsert({
    where: { email: 'expert-b@proxion.local' },
    update: { passwordHash, isActive: true },
    create: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      email: 'expert-b@proxion.local',
      passwordHash,
      role: Role.EXPERT,
    },
  });
  const reviewerB = await prisma.user.upsert({
    where: { email: 'reviewer-b@proxion.local' },
    update: { passwordHash, isActive: true },
    create: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      email: 'reviewer-b@proxion.local',
      passwordHash,
      role: Role.REVIEWER,
    },
  });

  const workspace = await prisma.project.upsert({
    where: { id: ids.projectWorkspace },
    update: {
      name: 'Evaluation workspace',
      description: 'Seeded active workflows for manual API and UI testing.',
    },
    create: {
      id: ids.projectWorkspace,
      name: 'Evaluation workspace',
      description: 'Seeded active workflows for manual API and UI testing.',
      createdById: admin.id,
    },
  });
  const archive = await prisma.project.upsert({
    where: { id: ids.projectArchive },
    update: {
      name: 'Completed delivery archive',
      description: 'Completed work with a scored, approved review.',
    },
    create: {
      id: ids.projectArchive,
      name: 'Completed delivery archive',
      description: 'Completed work with a scored, approved review.',
      createdById: admin.id,
    },
  });

  const taskInputs = [
    {
      id: ids.taskReady,
      projectId: workspace.id,
      title: 'Ready for assignment',
      instructions: 'A clean task for testing assignment and start transitions.',
      status: TaskStatus.ASSIGNED,
    },
    {
      id: ids.taskDraft,
      projectId: workspace.id,
      title: 'Draft response in progress',
      instructions: 'Improve the draft, create another version, or submit the latest one.',
      status: TaskStatus.IN_PROGRESS,
    },
    {
      id: ids.taskSubmitted,
      projectId: workspace.id,
      title: 'Submitted response awaiting review',
      instructions: 'Create a review with Quality rubric version 1.',
      status: TaskStatus.SUBMITTED,
    },
    {
      id: ids.taskReview,
      projectId: workspace.id,
      title: 'Open review awaiting scores',
      instructions: 'Score all criteria and then approve or request rework.',
      status: TaskStatus.IN_REVIEW,
    },
    {
      id: ids.taskRework,
      projectId: workspace.id,
      title: 'Rework requested',
      instructions: 'Review feedback is complete. Start work and submit a new version.',
      status: TaskStatus.REWORK,
    },
    {
      id: ids.taskApproved,
      projectId: archive.id,
      title: 'Approved delivery example',
      instructions: 'Read-only completed workflow with a fully scored review.',
      status: TaskStatus.APPROVED,
    },
  ];
  await Promise.all(
    taskInputs.map((input) =>
      prisma.task.upsert({ where: { id: input.id }, update: input, create: input }),
    ),
  );

  const assignmentInputs = [
    { id: ids.assignmentReady, taskId: ids.taskReady, expertId: expert.id },
    { id: ids.assignmentDraft, taskId: ids.taskDraft, expertId: expert.id },
    { id: ids.assignmentSubmitted, taskId: ids.taskSubmitted, expertId: expert.id },
    { id: ids.assignmentReview, taskId: ids.taskReview, expertId: expert.id },
    { id: ids.assignmentRework, taskId: ids.taskRework, expertId: expertB.id },
    { id: ids.assignmentApproved, taskId: ids.taskApproved, expertId: expert.id },
  ];
  const [
    ,
    assignmentDraft,
    assignmentSubmitted,
    assignmentReview,
    assignmentRework,
    assignmentApproved,
  ] = await Promise.all(
    assignmentInputs.map(({ id, taskId, expertId }) =>
      prisma.assignment.upsert({
        where: { taskId_expertId: { taskId, expertId } },
        update: { assignedById: admin.id },
        create: { id, taskId, expertId, assignedById: admin.id },
      }),
    ),
  );
  if (
    !assignmentDraft ||
    !assignmentSubmitted ||
    !assignmentReview ||
    !assignmentRework ||
    !assignmentApproved
  ) {
    throw new Error('Failed to seed assignments');
  }

  await prisma.rubric.upsert({
    where: { id: ids.rubricQuality },
    update: { projectId: workspace.id, name: 'Quality rubric' },
    create: { id: ids.rubricQuality, projectId: workspace.id, name: 'Quality rubric' },
  });
  await prisma.rubric.upsert({
    where: { id: ids.rubricDelivery },
    update: { projectId: archive.id, name: 'Delivery rubric' },
    create: { id: ids.rubricDelivery, projectId: archive.id, name: 'Delivery rubric' },
  });
  await Promise.all([
    prisma.rubricVersion.upsert({
      where: { id: ids.qualityV1 },
      update: { rubricId: ids.rubricQuality, version: 1 },
      create: { id: ids.qualityV1, rubricId: ids.rubricQuality, version: 1 },
    }),
    prisma.rubricVersion.upsert({
      where: { id: ids.qualityV2 },
      update: { rubricId: ids.rubricQuality, version: 2 },
      create: { id: ids.qualityV2, rubricId: ids.rubricQuality, version: 2 },
    }),
    prisma.rubricVersion.upsert({
      where: { id: ids.deliveryV1 },
      update: { rubricId: ids.rubricDelivery, version: 1 },
      create: { id: ids.deliveryV1, rubricId: ids.rubricDelivery, version: 1 },
    }),
  ]);
  await Promise.all([
    upsertCriterion({
      id: criteria.accuracy,
      rubricVersionId: ids.qualityV1,
      name: 'Accuracy',
      description: 'Claims are correct and traceable.',
      minScore: 0,
      maxScore: 5,
      weight: 0.5,
      position: 1,
    }),
    upsertCriterion({
      id: criteria.reasoning,
      rubricVersionId: ids.qualityV1,
      name: 'Reasoning',
      description: 'The conclusion follows from the analysis.',
      minScore: 0,
      maxScore: 5,
      weight: 0.3,
      position: 2,
    }),
    upsertCriterion({
      id: criteria.clarity,
      rubricVersionId: ids.qualityV1,
      name: 'Clarity',
      description: 'The response is concise and usable.',
      minScore: 0,
      maxScore: 5,
      weight: 0.2,
      position: 3,
    }),
    upsertCriterion({
      id: criteria.v2Accuracy,
      rubricVersionId: ids.qualityV2,
      name: 'Accuracy',
      description: 'Evidence is represented correctly.',
      minScore: 0,
      maxScore: 5,
      weight: 0.6,
      position: 1,
    }),
    upsertCriterion({
      id: criteria.v2Evidence,
      rubricVersionId: ids.qualityV2,
      name: 'Evidence coverage',
      description: 'Important evidence is not omitted.',
      minScore: 0,
      maxScore: 5,
      weight: 0.4,
      position: 2,
    }),
    upsertCriterion({
      id: criteria.delivery,
      rubricVersionId: ids.deliveryV1,
      name: 'Delivery quality',
      description: 'Deliverable meets the requested standard.',
      minScore: 0,
      maxScore: 10,
      weight: 1,
      position: 1,
    }),
  ]);

  const submittedAt = new Date('2026-09-08T09:00:00.000Z');
  const completedAt = new Date('2026-09-08T12:00:00.000Z');
  const submissionInputs = [
    {
      id: ids.draftSubmission,
      assignmentId: assignmentDraft.id,
      version: 1,
      status: SubmissionStatus.DRAFT,
      content:
        'Draft: the evidence supports the proposed decision, but the risk section needs a sharper recommendation.',
      submittedAt: null,
    },
    {
      id: ids.submittedSubmission,
      assignmentId: assignmentSubmitted.id,
      version: 1,
      status: SubmissionStatus.SUBMITTED,
      content:
        'Submitted response: the proposed approach is supported by the available evidence and has a clear implementation path.',
      submittedAt,
    },
    {
      id: ids.reviewSubmission,
      assignmentId: assignmentReview.id,
      version: 1,
      status: SubmissionStatus.SUBMITTED,
      content: 'Review me: analysis is complete and ready for criterion-level scoring.',
      submittedAt,
    },
    {
      id: ids.reworkSubmission,
      assignmentId: assignmentRework.id,
      version: 1,
      status: SubmissionStatus.SUBMITTED,
      content:
        'Initial response: it reaches the right conclusion but leaves two claims unsupported.',
      submittedAt,
    },
    {
      id: ids.approvedSubmission,
      assignmentId: assignmentApproved.id,
      version: 1,
      status: SubmissionStatus.SUBMITTED,
      content: 'Approved delivery: evidence, reasoning, and the final recommendation are aligned.',
      submittedAt,
    },
  ];
  await Promise.all(
    submissionInputs.map((input) =>
      prisma.submission.upsert({ where: { id: input.id }, update: input, create: input }),
    ),
  );

  await Promise.all([
    prisma.review.upsert({
      where: { id: ids.openReview },
      update: {
        submissionId: ids.reviewSubmission,
        reviewerId: reviewer.id,
        rubricVersionId: ids.qualityV1,
        status: ReviewStatus.OPEN,
        decision: null,
        completedAt: null,
      },
      create: {
        id: ids.openReview,
        submissionId: ids.reviewSubmission,
        reviewerId: reviewer.id,
        rubricVersionId: ids.qualityV1,
        status: ReviewStatus.OPEN,
      },
    }),
    prisma.review.upsert({
      where: { id: ids.reworkReview },
      update: {
        submissionId: ids.reworkSubmission,
        reviewerId: reviewerB.id,
        rubricVersionId: ids.qualityV1,
        status: ReviewStatus.COMPLETED,
        decision: ReviewDecision.REWORK_REQUESTED,
        completedAt,
      },
      create: {
        id: ids.reworkReview,
        submissionId: ids.reworkSubmission,
        reviewerId: reviewerB.id,
        rubricVersionId: ids.qualityV1,
        status: ReviewStatus.COMPLETED,
        decision: ReviewDecision.REWORK_REQUESTED,
        completedAt,
      },
    }),
    prisma.review.upsert({
      where: { id: ids.approvedReview },
      update: {
        submissionId: ids.approvedSubmission,
        reviewerId: reviewer.id,
        rubricVersionId: ids.deliveryV1,
        status: ReviewStatus.COMPLETED,
        decision: ReviewDecision.APPROVED,
        completedAt,
      },
      create: {
        id: ids.approvedReview,
        submissionId: ids.approvedSubmission,
        reviewerId: reviewer.id,
        rubricVersionId: ids.deliveryV1,
        status: ReviewStatus.COMPLETED,
        decision: ReviewDecision.APPROVED,
        completedAt,
      },
    }),
  ]);
  await prisma.reviewScore.upsert({
    where: {
      reviewId_rubricCriterionId: {
        reviewId: ids.approvedReview,
        rubricCriterionId: criteria.delivery,
      },
    },
    update: { score: 9, comment: 'Well structured, accurate, and ready to deliver.' },
    create: {
      reviewId: ids.approvedReview,
      rubricCriterionId: criteria.delivery,
      score: 9,
      comment: 'Well structured, accurate, and ready to deliver.',
    },
  });

  await Promise.all([
    seedAudit(AuditAction.PROJECT_CREATED, 'Project', workspace.id, admin.id, {
      name: workspace.name,
    }),
    seedAudit(AuditAction.TASK_CREATED, 'Task', ids.taskDraft, admin.id, {
      status: TaskStatus.IN_PROGRESS,
    }),
    seedAudit(AuditAction.EXPERT_ASSIGNED, 'Assignment', assignmentDraft.id, admin.id, {
      taskId: ids.taskDraft,
      expertId: expert.id,
    }),
    seedAudit(AuditAction.SUBMISSION_CREATED, 'Submission', ids.draftSubmission, expert.id, {
      assignmentId: assignmentDraft.id,
      version: 1,
    }),
    seedAudit(AuditAction.SUBMISSION_SUBMITTED, 'Submission', ids.reviewSubmission, expert.id, {
      status: SubmissionStatus.SUBMITTED,
    }),
    seedAudit(AuditAction.REVIEW_CREATED, 'Review', ids.openReview, admin.id, {
      status: ReviewStatus.OPEN,
    }),
    seedAudit(AuditAction.REVIEW_REWORK_REQUESTED, 'Review', ids.reworkReview, reviewerB.id, {
      status: ReviewStatus.COMPLETED,
      decision: ReviewDecision.REWORK_REQUESTED,
    }),
    seedAudit(AuditAction.REVIEW_APPROVED, 'Review', ids.approvedReview, reviewer.id, {
      status: ReviewStatus.COMPLETED,
      decision: ReviewDecision.APPROVED,
    }),
  ]);

  console.log({
    password,
    users: [admin.email, expert.email, expertB.email, reviewer.email, reviewerB.email],
    workspaceProjectId: workspace.id,
    qualityRubricVersionId: ids.qualityV1,
    scenarios: {
      ready: ids.taskReady,
      draft: ids.taskDraft,
      submitted: ids.taskSubmitted,
      openReview: ids.taskReview,
      rework: ids.taskRework,
      approved: ids.taskApproved,
    },
  });
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
