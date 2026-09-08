import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskWorkflowService } from './task-workflow.service';
import { TaskAccessPolicy } from './task-access.policy';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [TasksController],
  providers: [TasksService, TaskWorkflowService, TaskAccessPolicy],
  exports: [TasksService, TaskWorkflowService, TaskAccessPolicy],
})
export class TasksModule {}
