import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentValidationSchema } from './config';
import { PrismaModule } from './database/prisma.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { RubricsModule } from './modules/rubrics/rubrics.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: environmentValidationSchema,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    TasksModule,
    SubmissionsModule,
    RubricsModule,
    ReviewsModule,
    AuditLogsModule,
    HealthModule,
  ],
})
export class AppModule {}
