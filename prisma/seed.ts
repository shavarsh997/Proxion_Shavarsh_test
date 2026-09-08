import { PrismaClient, Role, TaskStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
const prisma = new PrismaClient();
async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 12);
  const [admin, expertB, expert, reviewerB, reviewer] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@proxion.local' },
      update: {},
      create: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'admin@proxion.local',
        passwordHash,
        role: Role.ADMIN,
      },
    }),
    prisma.user.upsert({
      where: { email: 'expert-b@proxion.local' },
      update: {},
      create: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        email: 'expert-b@proxion.local',
        passwordHash,
        role: Role.EXPERT,
      },
    }),
    prisma.user.upsert({
      where: { email: 'expert@proxion.local' },
      update: {},
      create: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        email: 'expert@proxion.local',
        passwordHash,
        role: Role.EXPERT,
      },
    }),
    prisma.user.upsert({
      where: { email: 'reviewer-b@proxion.local' },
      update: {},
      create: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        email: 'reviewer-b@proxion.local',
        passwordHash,
        role: Role.REVIEWER,
      },
    }),
    prisma.user.upsert({
      where: { email: 'reviewer@proxion.local' },
      update: {},
      create: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        email: 'reviewer@proxion.local',
        passwordHash,
        role: Role.REVIEWER,
      },
    }),
  ]);
  const project = await prisma.project.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Seed evaluation project',
      description: 'Ready-to-exercise workflow sample',
      createdById: admin.id,
    },
  });
  const task = await prisma.task.upsert({
    where: { id: '22222222-2222-4222-8222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: project.id,
      title: 'Evaluate sample response',
      instructions: 'Provide a concise evidence-backed assessment.',
      status: TaskStatus.ASSIGNED,
    },
  });
  const assignment = await prisma.assignment.upsert({
    where: { taskId_expertId: { taskId: task.id, expertId: expert.id } },
    update: {},
    create: { taskId: task.id, expertId: expert.id, assignedById: admin.id },
  });
  let rubric = await prisma.rubric.findFirst({
    where: { projectId: project.id, name: 'Quality rubric' },
  });
  if (!rubric) {
    rubric = await prisma.rubric.create({
      data: {
        projectId: project.id,
        name: 'Quality rubric',
        versions: {
          create: {
            version: 1,
            criteria: {
              create: [
                {
                  name: 'Accuracy',
                  description: 'Claims are supported',
                  minScore: 0,
                  maxScore: 5,
                  weight: 0.6,
                  position: 1,
                },
                {
                  name: 'Clarity',
                  description: 'Response is easy to follow',
                  minScore: 0,
                  maxScore: 5,
                  weight: 0.4,
                  position: 2,
                },
              ],
            },
          },
        },
      },
    });
  }
  console.log({
    admin: admin.email,
    expert: expert.email,
    expertB: expertB.email,
    reviewer: reviewer.email,
    reviewerB: reviewerB.email,
    projectId: project.id,
    taskId: task.id,
    assignmentId: assignment.id,
    rubricId: rubric.id,
  });
}
void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
