import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { ReviewsController } from './reviews.controller';
import { ReviewAccessPolicy } from './review-access.policy';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [TasksModule, UsersModule, AuthModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewAccessPolicy, JwtAuthGuard, RolesGuard],
})
export class ReviewsModule {}
