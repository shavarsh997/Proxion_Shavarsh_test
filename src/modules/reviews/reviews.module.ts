import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { ReviewAccessPolicy } from './review-access.policy';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TasksModule, UsersModule, AuthModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewAccessPolicy],
})
export class ReviewsModule {}
