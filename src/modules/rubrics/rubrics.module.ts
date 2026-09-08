import { Module } from '@nestjs/common';
import { RubricsController } from './rubrics.controller';
import { RubricsService } from './rubrics.service';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [AuthModule],
  controllers: [RubricsController],
  providers: [RubricsService],
  exports: [RubricsService],
})
export class RubricsModule {}
