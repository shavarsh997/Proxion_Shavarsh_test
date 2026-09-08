import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [TasksModule, AuthModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, JwtAuthGuard, RolesGuard],
})
export class SubmissionsModule {}
