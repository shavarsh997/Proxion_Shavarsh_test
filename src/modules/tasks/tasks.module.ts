import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TasksController } from './tasks.controller';
import { TaskAccessPolicy } from './task-access.policy';
import { TaskWorkflowService } from './task-workflow.service';
import { TasksService } from './tasks.service';

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [TasksController],
  providers: [TasksService, TaskWorkflowService, TaskAccessPolicy, JwtAuthGuard, RolesGuard],
  exports: [TaskWorkflowService, TaskAccessPolicy],
})
export class TasksModule {}
