import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskWorkflowService } from './task-workflow.service';
@Module({
  controllers: [TasksController],
  providers: [TasksService, TaskWorkflowService],
  exports: [TasksService, TaskWorkflowService],
})
export class TasksModule {}
