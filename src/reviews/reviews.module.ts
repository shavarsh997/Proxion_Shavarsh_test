import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { TasksModule } from '../tasks/tasks.module';
@Module({ imports: [TasksModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
