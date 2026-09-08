import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthModule } from '../auth/auth.module';
import { RubricsController } from './rubrics.controller';
import { RubricsService } from './rubrics.service';

@Module({
  imports: [AuthModule],
  controllers: [RubricsController],
  providers: [RubricsService, JwtAuthGuard, RolesGuard],
})
export class RubricsModule {}
