import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [TasksModule, AuthModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
